"""
NOVARA Platform – Shared enumerations
Unified Data Model v1 + Delta (16 Aug 2026)
"""
from __future__ import annotations

from enum import Enum


class OrgType(str, Enum):
    OWNER = "Owner"
    MANAGEMENT_COMPANY = "ManagementCompany"
    CONTRACTOR = "Contractor"
    UTILITY = "Utility"
    INTERNAL = "Internal"


class CustomerType(str, Enum):
    HOTEL = "Hotel"
    MULTI_FAMILY = "Multi-Family"
    PRIVATE_SCHOOL = "Private School"
    YMCA_NONPROFIT = "YMCA / Nonprofit"
    SWIMMING_SCHOOL = "Swimming School"
    COUNTRY_CLUB = "Country Club"
    OTHER = "Other"


class PipelineStatus(str, Enum):
    LEAD = "Lead"
    QUALIFICATION = "Qualification"
    SUMMARY_REPORT = "Summary Report"
    PROPOSAL = "Proposal"
    LOI = "LOI"
    SITE_SURVEY = "Site Survey"
    ADDITIONAL_MEASURES = "Additional Measures"
    CONTRACT = "Contract"
    VENDOR_SELECTED = "Vendor Selected"
    INSTALLATION = "Installation"
    CONTROL_ENGAGED = "Control Engaged"
    FIRST_SAVINGS = "First Savings Report"
    ACTIVE = "Active"
    INACTIVE = "Inactive"
    DISQUALIFIED = "Disqualified"


class SystemType(str, Enum):
    POOL = "Pool"
    DHW = "DHW"
    HVAC = "HVAC"
    SPA = "Spa"
    OTHER = "Other"


class FuelType(str, Enum):
    NG = "NG"
    PROPANE = "Propane"
    ELECTRIC = "Electric"
    HYBRID = "Hybrid"
    OTHER = "Other"


class CapacityUnit(str, Enum):
    BTU = "BTU"
    KW = "kW"
    TONS = "Tons"
    OTHER = "Other"


class EquipmentType(str, Enum):
    HEATER = "Heater"
    CONTROLLER = "Controller"
    TEMPERATURE_SENSOR = "TemperatureSensor"
    FLOW_SENSOR = "FlowSensor"
    PUMP = "Pump"
    OTHER = "Other"


class EquipmentStatus(str, Enum):
    ONLINE = "Online"
    OFFLINE = "Offline"
    FAULT = "Fault"
    UNKNOWN = "Unknown"


class ReadingSource(str, Enum):
    ONSITE = "onsite"
    WEATHER_MODEL = "weather_model"
    UTILITY = "utility"


class EnergyUnit(str, Enum):
    THERMS = "therms"
    KWH = "kWh"


class ReportType(str, Enum):
    FIRST_SAVINGS = "First Savings"
    MONTHLY = "Monthly"
    CUSTOM = "Custom"


class UserRole(str, Enum):
    ADMIN = "Admin"
    CEGY = "CEGY"
    UTILITY = "Utility"
    OPERATOR = "Operator"
    OWNER = "Owner"
    MANAGEMENT_COMPANY = "ManagementCompany"
    CONTRACTOR = "Contractor"
    READ_ONLY = "ReadOnly"


class UserStatus(str, Enum):
    PENDING = "Pending"
    APPROVED = "Approved"
    REJECTED = "Rejected"
    SUSPENDED = "Suspended"


class RelayState(str, Enum):
    ON = "ON"
    OFF = "OFF"
    UNKNOWN = "UNKNOWN"


class PipeMaterial(str, Enum):
    COPPER = "Copper"
    PVC = "PVC"
    OTHER = "Other"


class SpaAlertType(str, Enum):
    HEATER_ON_DURING_OFF_WINDOW = "HeaterOnDuringOffWindow"
    TEMP_HIGH = "TempHigh"
    TEMP_LOW = "TempLow"
