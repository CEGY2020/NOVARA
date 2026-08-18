"""
NOVARA Platform – Core data models
Unified Data Model v1 + Delta (16 Aug 2026)

Hierarchy: Organization → Site → System → Equipment
Verticals: NOVARA Pool (optimized), Spa (monitor-only), DHW, HVAC
"""
from __future__ import annotations

from datetime import datetime, date, time
from typing import Optional, List, Dict, Any
from uuid import uuid4

from pydantic import BaseModel, Field

from .enums import (
    OrgType,
    CustomerType,
    PipelineStatus,
    SystemType,
    FuelType,
    CapacityUnit,
    EquipmentType,
    EquipmentStatus,
    ReadingSource,
    EnergyUnit,
    ReportType,
    UserRole,
    UserStatus,
    RelayState,
    PipeMaterial,
    SpaAlertType,
)


def _new_id() -> str:
    return str(uuid4())


class Organization(BaseModel):
    id: str = Field(default_factory=_new_id)
    name: str
    org_type: OrgType
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class StatusHistoryEntry(BaseModel):
    from_status: str
    to_status: str
    at: datetime
    note: str = ""
    by_user: Optional[str] = None


class Site(BaseModel):
    id: str = Field(default_factory=_new_id)
    name: str
    organization_id: str
    customer_type: CustomerType
    address: str
    city: str
    state: str = "CA"
    zip_code: str
    latitude: float
    longitude: float
    timezone: str = "America/Los_Angeles"

    year_round_open: bool = True
    has_pool_cover: bool = False
    liability_notes: Optional[str] = None

    service_org_id: Optional[str] = None
    primary_tech_name: Optional[str] = None
    primary_tech_phone: Optional[str] = None
    primary_tech_email: Optional[str] = None
    site_photo_url: Optional[str] = None
    building_notes: Optional[str] = None

    status: PipelineStatus = PipelineStatus.LEAD
    status_history: List[StatusHistoryEntry] = Field(default_factory=list)
    first_contact_date: Optional[date] = None
    contract_date: Optional[date] = None
    installation_date: Optional[date] = None
    control_engaged_date: Optional[date] = None
    sanity_check_passed: Optional[bool] = None
    sanity_check_date: Optional[date] = None

    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def advance_status(self, new_status: PipelineStatus, note: str = "", by_user: str = "") -> None:
        self.status_history.append(
            StatusHistoryEntry(
                from_status=self.status.value,
                to_status=new_status.value,
                at=datetime.utcnow(),
                note=note,
                by_user=by_user or None,
            )
        )
        self.status = new_status
        self.updated_at = datetime.utcnow()


class System(BaseModel):
    id: str = Field(default_factory=_new_id)
    site_id: str
    name: str
    code: Optional[str] = None
    system_type: SystemType
    fuel_type: FuelType
    capacity_unit: Optional[CapacityUnit] = None
    rated_input: Optional[float] = None
    is_active: bool = True
    monitor_only: bool = False
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Equipment(BaseModel):
    id: str = Field(default_factory=_new_id)
    system_id: str
    equipment_type: EquipmentType
    name: str
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    install_date: Optional[date] = None
    rated_capacity: Optional[float] = None
    is_controllable: bool = False
    status: EquipmentStatus = EquipmentStatus.UNKNOWN
    last_seen: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PoolConfig(BaseModel):
    system_id: str
    length_ft: float
    width_ft: float
    avg_depth_ft: float
    surface_area_ft2: Optional[float] = None
    volume_gal: Optional[float] = None

    open_time: time = time(8, 0)
    close_time: time = time(21, 0)
    target_setpoint_f: float = 82.0
    desired_temp_f: Optional[float] = None
    min_acceptable_f: float = 78.0

    heater_input_btu_h: float = 400_000.0
    heater_efficiency: float = 0.82
    measured_heater_btu_h: Optional[float] = None
    heater_make: Optional[str] = None
    heater_model: Optional[str] = None

    activity_factor: float = 1.0
    orientation_deg: Optional[float] = None
    shading_factor: float = 0.0
    pipe_material: Optional[PipeMaterial] = None
    pump_hp: Optional[float] = None
    pump_24hr: bool = False

    sensor_offset_temp: float = 0.0
    sensor_offset_humidity: float = 0.0
    sensor_offset_wind: float = 0.0

    safety_margin_hours: float = 0.5
    max_runtime_hours: float = 12.0
    rain_skip_enabled: bool = True
    commissioning_open_offset_minutes: int = 60

    def model_post_init(self, __context: Any) -> None:
        if self.surface_area_ft2 is None:
            self.surface_area_ft2 = self.length_ft * self.width_ft
        if self.volume_gal is None and self.surface_area_ft2 is not None:
            self.volume_gal = self.surface_area_ft2 * self.avg_depth_ft * 7.48052
        if self.desired_temp_f is None:
            self.desired_temp_f = self.target_setpoint_f

    @property
    def mass_lb(self) -> float:
        return (self.volume_gal or 0.0) * 8.34

    @property
    def heater_output_btu_h(self) -> float:
        if self.measured_heater_btu_h and self.measured_heater_btu_h > 0:
            return self.measured_heater_btu_h
        return self.heater_input_btu_h * self.heater_efficiency


class SpaConfig(BaseModel):
    """Spas: flat-line <=104 F + time clock. No savings optimization."""
    system_id: str
    setpoint_f: float = 104.0
    max_setpoint_f: float = 104.0
    min_temp_f: float = 95.0
    timeclock_off_start: time = time(22, 0)
    timeclock_off_end: time = time(6, 0)
    monitor_only: bool = True
    notes: Optional[str] = None


class SpaAlert(BaseModel):
    id: str = Field(default_factory=_new_id)
    system_id: str
    alert_type: SpaAlertType
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    message: str
    acknowledged: bool = False


class Controller(BaseModel):
    equipment_id: str
    firmware_version: Optional[str] = None
    heater_relay_state: RelayState = RelayState.UNKNOWN
    current_schedule: Optional[Dict[str, Any]] = None
    last_communication: Optional[datetime] = None


class GasAccount(BaseModel):
    id: str = Field(default_factory=_new_id)
    site_id: str
    system_id: Optional[str] = None
    utility_account_number: Optional[str] = None
    meter_number: Optional[str] = None
    is_dedicated: bool = True
    shared_with: List[str] = Field(default_factory=list)
    fuel_type: FuelType = FuelType.NG
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SensorReading(BaseModel):
    id: str = Field(default_factory=_new_id)
    site_id: str
    system_id: str
    equipment_id: Optional[str] = None
    timestamp: datetime
    source: ReadingSource = ReadingSource.ONSITE
    pool_temp_f: Optional[float] = None
    air_temp_f: Optional[float] = None
    rh_pct: Optional[float] = None
    wind_mph: Optional[float] = None
    solar_w_m2: Optional[float] = None
    cloud_frac: Optional[float] = None
    precip_mm: Optional[float] = None
    heater_runtime_minutes: Optional[float] = None
    power_kw: Optional[float] = None
    heater_relay_state: Optional[RelayState] = None


class HeatBalanceResult(BaseModel):
    id: str = Field(default_factory=_new_id)
    system_id: str
    timestamp: datetime
    pool_temp_f: float
    adjusted_setpoint_f: float
    estimated_runtime_hours: float
    heater_on_time: Optional[str] = None
    heater_off_time: Optional[str] = None
    skip_heating: bool
    net_heat_rate: float
    breakdown: Dict[str, float] = Field(default_factory=dict)
    recommendation: str = ""
    calibration_residual_f: Optional[float] = None
    # Setpoint-based field command (derived)
    command_setpoint_f: Optional[float] = None   # 50 = off; else target temp
    command_start_time: Optional[str] = None     # HH:MM when to apply


class ControlCommand(BaseModel):
    """
    Command sent to NOVARA Pool field hardware.
    Cloud calculates; hardware executes.
    setpoint_f = 50  → keep heater OFF
    setpoint_f = target temp + start_time → turn on / hold
    """
    id: str = Field(default_factory=_new_id)
    system_id: str
    setpoint_f: float                    # 50.0 = OFF; otherwise desired pool temp
    effective_at: datetime               # when hardware should apply this setpoint
    source: str = "engine"               # engine | manual | failsafe_recovery
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    sent_at: Optional[datetime] = None
    acked_at: Optional[datetime] = None
    # Failsafe context (informational for operators)
    # On comms/power loss: relay NC, local control holds desired+1 F


class MVRecord(BaseModel):
    id: str = Field(default_factory=_new_id)
    system_id: str
    period_start: date
    period_end: date
    base_energy: float
    post_energy: float
    savings_energy: float
    energy_unit: EnergyUnit
    heater_runtime_hours: Optional[float] = None
    avg_temp_f: Optional[float] = None
    report_type: ReportType = ReportType.MONTHLY
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

    @property
    def savings_pct(self) -> float:
        if self.base_energy <= 0:
            return 0.0
        return (self.savings_energy / self.base_energy) * 100.0


class User(BaseModel):
    id: str = Field(default_factory=_new_id)
    email: str
    hashed_password: str
    full_name: str
    role: UserRole
    organization_id: Optional[str] = None
    status: UserStatus = UserStatus.PENDING
    last_login: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PortfolioSummary(BaseModel):
    as_of: date
    target_installs: int = 120
    sites_by_status: Dict[str, int] = Field(default_factory=dict)
    sites_by_customer_type: Dict[str, int] = Field(default_factory=dict)
    sites_by_system_type: Dict[str, int] = Field(default_factory=dict)
    cumulative_savings_therms: float = 0.0
    cumulative_savings_kwh: float = 0.0
    active_systems: int = 0
