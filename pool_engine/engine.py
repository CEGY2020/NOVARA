"""
NOVARA Platform – Calculation engine (NOVARA Pool + Spa monitoring)

Physical core ported from PHEEP; extended per Engine Spec (Part B):
  - Solar-adjusted setpoint
  - Measured heater capacity preferred
  - Heater on/off time recommendation
  - Fuzzy calibration hook
  - Spa monitor-only rules (B.13) — no savings optimization
"""
from __future__ import annotations

import math
from datetime import datetime, timezone, time, timedelta
from typing import Dict, Any, Tuple, Optional, List

from .models import (
    PoolConfig,
    SpaConfig,
    SensorReading,
    HeatBalanceResult,
    SpaAlert,
)
from .enums import SpaAlertType, RelayState

# Physical constants
LATENT_HEAT_BTU_PER_LB = 1040.0
STEFAN_BOLTZMANN = 0.1713e-8
WATER_SPECIFIC_HEAT = 1.0


def saturation_vapor_pressure_inHg(T_f: float) -> float:
    T_c = (T_f - 32.0) * 5.0 / 9.0
    p_sat_mbar = 6.112 * math.exp((17.67 * T_c) / (T_c + 243.5))
    return p_sat_mbar * 0.02953


def evaporation_heat_loss_btu_h(
    area_ft2: float, T_pool_f: float, T_air_f: float,
    rh_pct: float, wind_mph: float, activity_factor: float = 1.0,
) -> float:
    pw = saturation_vapor_pressure_inHg(T_pool_f)
    pa = (rh_pct / 100.0) * saturation_vapor_pressure_inHg(T_air_f)
    coeff = 0.1 + 0.04 * wind_mph
    mass_flux = coeff * max(pw - pa, 0.0)
    return mass_flux * area_ft2 * LATENT_HEAT_BTU_PER_LB * activity_factor


def convection_heat_loss_btu_h(
    area_ft2: float, T_pool_f: float, T_air_f: float, wind_mph: float,
) -> float:
    h = 0.6 + 0.35 * wind_mph
    return h * area_ft2 * (T_pool_f - T_air_f)


def radiation_heat_loss_btu_h(
    area_ft2: float, T_pool_f: float, T_air_f: float, cloud_frac: float = 0.3,
) -> float:
    T_pool_R = T_pool_f + 460.0
    T_sky_f = T_air_f - 20.0 * (1.0 - 0.8 * cloud_frac)
    T_sky_R = T_sky_f + 460.0
    epsilon = 0.95
    Q = epsilon * STEFAN_BOLTZMANN * area_ft2 * (T_pool_R**4 - T_sky_R**4)
    return max(Q, 0.0)


def transmission_heat_loss_btu_h(
    area_ft2: float, T_pool_f: float, ground_temp_f: float = 60.0,
) -> float:
    return 0.15 * area_ft2 * (T_pool_f - ground_temp_f)


def total_heat_loss_btu_h(
    area_ft2: float, T_pool_f: float, T_air_f: float, rh_pct: float,
    wind_mph: float, cloud_frac: float = 0.3, activity: float = 1.0,
) -> Dict[str, float]:
    Q_evap = evaporation_heat_loss_btu_h(area_ft2, T_pool_f, T_air_f, rh_pct, wind_mph, activity)
    Q_conv = convection_heat_loss_btu_h(area_ft2, T_pool_f, T_air_f, wind_mph)
    Q_rad = radiation_heat_loss_btu_h(area_ft2, T_pool_f, T_air_f, cloud_frac)
    Q_trans = transmission_heat_loss_btu_h(area_ft2, T_pool_f)
    total = Q_evap + Q_conv + Q_rad + Q_trans
    return {
        "evaporation": Q_evap, "convection": Q_conv, "radiation": Q_rad,
        "transmission": Q_trans, "total": total,
        "evap_fraction": Q_evap / total if total > 0 else 0.0,
    }


def solar_heat_gain_btu_h(
    area_ft2: float, shortwave_radiation_W_m2: float,
    absorptivity: float = 0.85, shading_factor: float = 0.0,
) -> float:
    G_btu_h_ft2 = shortwave_radiation_W_m2 * 0.3170
    effective_abs = absorptivity * (1.0 - max(0.0, min(1.0, shading_factor)))
    return area_ft2 * G_btu_h_ft2 * effective_abs


def energy_to_raise_temp_btu(mass_lb: float, delta_T_f: float) -> float:
    return mass_lb * WATER_SPECIFIC_HEAT * delta_T_f


def estimate_net_heat_rate_btu_h(
    cfg: PoolConfig, T_pool_f: float, site: Dict[str, float],
    activity: Optional[float] = None,
) -> Tuple[float, Dict[str, float]]:
    act = activity if activity is not None else cfg.activity_factor
    area = cfg.surface_area_ft2 or (cfg.length_ft * cfg.width_ft)
    losses = total_heat_loss_btu_h(
        area, T_pool_f, site["T_air_f"], site["rh_pct"],
        site["wind_mph"], site.get("cloud_frac", 0.3), act,
    )
    gain = solar_heat_gain_btu_h(
        area, site.get("solar_W_m2", 0.0), shading_factor=cfg.shading_factor
    )
    net = gain - losses["total"]
    return net, {**losses, "solar_gain": gain, "net": net}


def adjusted_desired_temperature(cfg: PoolConfig, site: Dict[str, float]) -> float:
    desired = cfg.desired_temp_f if cfg.desired_temp_f is not None else cfg.target_setpoint_f
    area = cfg.surface_area_ft2 or (cfg.length_ft * cfg.width_ft)
    solar_gain = solar_heat_gain_btu_h(
        area, site.get("solar_W_m2", 0.0), shading_factor=cfg.shading_factor
    )
    mass = cfg.mass_lb or 1.0
    solar_delta = (solar_gain * 4.0) / (mass * WATER_SPECIFIC_HEAT) if mass > 0 else 0.0
    return max(cfg.min_acceptable_f, desired - min(2.5, solar_delta * 0.6))


def hours_to_reach_setpoint(
    cfg: PoolConfig, T_current_f: float, T_target_f: float, site: Dict[str, float],
) -> float:
    if T_current_f >= T_target_f:
        return 0.0
    delta = T_target_f - T_current_f
    energy_needed = energy_to_raise_temp_btu(cfg.mass_lb, delta)
    mid_T = (T_current_f + T_target_f) / 2.0
    net_without_heater, _ = estimate_net_heat_rate_btu_h(cfg, mid_T, site)
    effective = cfg.heater_output_btu_h + net_without_heater
    if effective <= 0:
        return float("inf")
    hours = energy_needed / effective
    return min(hours + cfg.safety_margin_hours, cfg.max_runtime_hours)


def _parse_open_time(cfg: PoolConfig, now: datetime) -> datetime:
    ot = cfg.open_time
    open_dt = now.replace(hour=ot.hour, minute=ot.minute, second=0, microsecond=0)
    if cfg.commissioning_open_offset_minutes:
        open_dt = open_dt + timedelta(minutes=cfg.commissioning_open_offset_minutes)
    return open_dt


def recommend_heater_on_off(
    cfg: PoolConfig, T_current_f: float, site: Dict[str, float],
    now: Optional[datetime] = None,
) -> Tuple[Optional[str], Optional[str], float, bool]:
    now = now or datetime.now(timezone.utc)
    now_local = now.replace(tzinfo=None) if now.tzinfo else now
    adjusted = adjusted_desired_temperature(cfg, site)

    skip = (
        cfg.rain_skip_enabled
        and site.get("precip_mm", 0) > 2.0
        and site.get("solar_W_m2", 0) < 50
        and T_current_f > cfg.min_acceptable_f + 1
    )
    if skip:
        return None, None, 0.0, True

    runtime_h = hours_to_reach_setpoint(cfg, T_current_f, adjusted, site)
    if runtime_h == float("inf"):
        return None, None, runtime_h, False

    open_dt = _parse_open_time(cfg, now_local)
    on_dt = open_dt - timedelta(hours=runtime_h)
    if on_dt < now_local:
        on_dt = now_local

    net, _ = estimate_net_heat_rate_btu_h(cfg, adjusted, site)
    loss_rate = abs(min(net, 0.0)) or 1.0
    coast_h = energy_to_raise_temp_btu(cfg.mass_lb, 1.0) / loss_rate
    coast_h = min(max(coast_h, 0.1), 2.0)
    off_dt = open_dt - timedelta(hours=coast_h * 0.3)

    on_str = on_dt.strftime("%H:%M")
    off_str = off_dt.strftime("%H:%M") if off_dt > on_dt else None
    return on_str, off_str, runtime_h, False


def recommend_heater_schedule(
    cfg: PoolConfig, T_current_f: float, site: Dict[str, float],
    system_id: str = "unknown", now: Optional[datetime] = None,
) -> HeatBalanceResult:
    now = now or datetime.now(timezone.utc)
    adjusted = adjusted_desired_temperature(cfg, site)
    on_str, off_str, runtime_h, skip = recommend_heater_on_off(cfg, T_current_f, site, now)
    net, breakdown = estimate_net_heat_rate_btu_h(cfg, T_current_f, site)

    if skip:
        recommendation = "Skip heating (rain / already warm enough)"
    elif runtime_h == 0:
        recommendation = "At or above adjusted setpoint — heater off"
    elif runtime_h == float("inf"):
        recommendation = "Heater capacity insufficient under current conditions"
    else:
        recommendation = (
            f"Start heater at {on_str}"
            + (f", off near {off_str}" if off_str else "")
            + f" (~{runtime_h:.1f} h runtime to reach {adjusted:.1f} F)"
        )

    # Field command: 50 F = OFF; otherwise send target setpoint + start time
    if skip or runtime_h == 0:
        cmd_setpoint = 50.0
        cmd_start = None
    else:
        cmd_setpoint = round(adjusted, 1)
        cmd_start = on_str

    return HeatBalanceResult(
        system_id=system_id,
        timestamp=now if getattr(now, "tzinfo", None) else now.replace(tzinfo=timezone.utc),
        pool_temp_f=T_current_f,
        adjusted_setpoint_f=round(adjusted, 1),
        estimated_runtime_hours=round(runtime_h, 2) if runtime_h != float("inf") else -1.0,
        heater_on_time=on_str,
        heater_off_time=off_str,
        skip_heating=skip,
        net_heat_rate=round(net, 0),
        breakdown={
            k: (round(v, 3) if k == "evap_fraction" else round(v, 0))
            for k, v in breakdown.items()
        },
        recommendation=recommendation,
        command_setpoint_f=cmd_setpoint,
        command_start_time=cmd_start,
    )


def calculate_heat_balance(
    pool: PoolConfig, reading: SensorReading,
    weather: Optional[Dict[str, float]] = None,
) -> HeatBalanceResult:
    site = weather or {
        "T_air_f": reading.air_temp_f or 70.0,
        "rh_pct": reading.rh_pct or 50.0,
        "wind_mph": reading.wind_mph or 5.0,
        "solar_W_m2": reading.solar_w_m2 or 0.0,
        "cloud_frac": reading.cloud_frac or 0.3,
        "precip_mm": reading.precip_mm or 0.0,
    }
    site = {
        **site,
        "T_air_f": site["T_air_f"] + pool.sensor_offset_temp,
        "rh_pct": min(100.0, max(0.0, site["rh_pct"] + pool.sensor_offset_humidity)),
        "wind_mph": max(0.0, site["wind_mph"] + pool.sensor_offset_wind),
    }
    T_pool = reading.pool_temp_f if reading.pool_temp_f is not None else pool.target_setpoint_f
    return recommend_heater_schedule(
        pool, T_pool, site, system_id=pool.system_id, now=reading.timestamp
    )


def update_calibration_offset(
    previous_offset_f: float, predicted_delta_f: float,
    actual_delta_f: float, learning_rate: float = 0.5,
) -> float:
    error = predicted_delta_f - actual_delta_f
    return previous_offset_f - error * learning_rate


def _time_in_off_window(t: time, off_start: time, off_end: time) -> bool:
    if off_start <= off_end:
        return off_start <= t < off_end
    return t >= off_start or t < off_end


def check_spa_status(
    spa: SpaConfig, reading: SensorReading, now: Optional[datetime] = None,
) -> List[SpaAlert]:
    """Monitor-only: heater on during off window, temp high/low. No savings logic."""
    alerts: List[SpaAlert] = []
    now = now or reading.timestamp or datetime.utcnow()
    local_t = now.time() if hasattr(now, "time") else datetime.utcnow().time()

    if reading.heater_relay_state == RelayState.ON and _time_in_off_window(
        local_t, spa.timeclock_off_start, spa.timeclock_off_end
    ):
        alerts.append(SpaAlert(
            system_id=spa.system_id,
            alert_type=SpaAlertType.HEATER_ON_DURING_OFF_WINDOW,
            timestamp=now if isinstance(now, datetime) else datetime.utcnow(),
            message=(
                f"Spa heater is ON during off window "
                f"({spa.timeclock_off_start.strftime('%H:%M')}-"
                f"{spa.timeclock_off_end.strftime('%H:%M')})"
            ),
        ))

    temp = reading.pool_temp_f
    if temp is not None:
        if temp > spa.max_setpoint_f + 0.5:
            alerts.append(SpaAlert(
                system_id=spa.system_id,
                alert_type=SpaAlertType.TEMP_HIGH,
                timestamp=now if isinstance(now, datetime) else datetime.utcnow(),
                message=f"Spa temperature {temp:.1f} F exceeds max {spa.max_setpoint_f:.1f} F",
            ))
        if temp < spa.min_temp_f - 0.5:
            alerts.append(SpaAlert(
                system_id=spa.system_id,
                alert_type=SpaAlertType.TEMP_LOW,
                timestamp=now if isinstance(now, datetime) else datetime.utcnow(),
                message=f"Spa temperature {temp:.1f} F below minimum {spa.min_temp_f:.1f} F",
            ))
    return alerts


def demo():
    cfg = PoolConfig(
        system_id="demo-pool-1",
        length_ft=20.0, width_ft=20.0, avg_depth_ft=5.0,
        heater_input_btu_h=399_000.0, heater_efficiency=0.82,
        open_time=time(8, 0), target_setpoint_f=82.0,
    )
    site = {
        "T_air_f": 68.0, "rh_pct": 65.0, "wind_mph": 6.0,
        "solar_W_m2": 0.0, "cloud_frac": 0.4, "precip_mm": 0.0,
    }
    result = recommend_heater_schedule(cfg, 76.5, site, system_id="demo-pool-1")
    print("=" * 60)
    print("NOVARA Pool Engine Demo")
    print("=" * 60)
    print(f"Pool temp        : {result.pool_temp_f} F")
    print(f"Adjusted setpoint: {result.adjusted_setpoint_f} F")
    print(f"Runtime needed   : {result.estimated_runtime_hours} h")
    print(f"Heater on        : {result.heater_on_time}")
    print(f"Heater off       : {result.heater_off_time}")
    print(f"Recommendation   : {result.recommendation}")
    print(f"Skip             : {result.skip_heating}")
    print("Breakdown (Btu/h):")
    for k, v in result.breakdown.items():
        print(f"  {k:15s}: {v}")
    print("=" * 60)

    spa = SpaConfig(system_id="demo-spa-1", setpoint_f=104.0)
    reading = SensorReading(
        site_id="demo", system_id="demo-spa-1",
        timestamp=datetime.now().replace(hour=23, minute=30),
        pool_temp_f=105.5, heater_relay_state=RelayState.ON,
    )
    alerts = check_spa_status(spa, reading, now=reading.timestamp)
    print("\\nSpa alerts:")
    for a in alerts:
        print(f"  [{a.alert_type.value}] {a.message}")


if __name__ == "__main__":
    demo()
