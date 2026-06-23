from sqlalchemy import (
    Column, String, Integer, BigInteger , Float, Date, DateTime , Time , Enum, ForeignKey , Boolean , Sequence , text ,  UniqueConstraint , JSON
)
from sqlalchemy.orm import relationship
from datetime import datetime
from db.base import Base
import enum



# Define allowed user types
class UserType(enum.Enum):
    owner = "owner"
    staff = "staff"
    customer_support = "customer_support"
    rto = "rto"


class Users(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True , index = True)
    name = Column(String)
    email = Column(String, unique=True, nullable=False, index=True )
    password = Column(String, nullable=False)
    user_type = Column(Enum(UserType), nullable=False)
    is_disabled = Column(Boolean , default = False)
    frenchise_id = Column(Integer, ForeignKey("frenchise.id"), nullable=True , index = True)



class Frenchise(Base):
    __tablename__ = "frenchise"

    id = Column(Integer, primary_key=True, autoincrement=True , index = True)
    frenchise_name = Column(String , index = True)
    owner_name = Column(String)
    phone_number = Column(String)
    email = Column(String)
    gst_number = Column(String)
    tan_number = Column(String)
    kyc_id_number = Column(String)
    kyc_doc_type = Column(String)
    kyc_doc = Column(String)
    agreement_doc = Column(String)
    website_url = Column(String)
    moto = Column(String)
    frenchise_code = Column(String)
    city = Column(String(50))
    business_address = Column(String)


class Clients(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, autoincrement=True , index = True)
    name = Column(String, index = True)
    cin_number = Column(String)
    phone_number = Column(String , index = True)
    email = Column(String)
    pincode = Column(String)
    gst_number = Column(String)
    pan_number = Column(String)
    tan_number = Column(String)
    payment_term = Column(String)
    kyc_id_number = Column(String)
    kyc_doc_type = Column(String)
    kyc_doc = Column(String)
    agreement_doc = Column(String)
    city = Column(String)
    dsr_act_cust_code = Column(String, index = True)
    address = Column(String)


    frenchise_id = Column(Integer, ForeignKey("frenchise.id"), nullable=True)





class DSRRecord(Base):
    __tablename__ = "dsr_records"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    frenchise_id = Column(Integer, ForeignKey("frenchise.id"), nullable=True , index = True)

    DSR_BRANCH_CODE = Column(String)
    DSR_CNNO = Column(String , index = True)
    DSR_BOOKED_BY = Column(String)
    DSR_CUST_CODE = Column(String , index = True)

    CHARGEABLE_WEIGHT = Column(Float)
    DSR_CN_TYPE = Column(String)
    DSR_DEST = Column(String)
    DSR_MODE = Column(String)
    DSR_NO_OF_PIECES = Column(Integer)
    DSR_DEST_PIN = Column(String)

    DSR_BOOKING_DATE = Column(Date , index = True)
    DSR_AMT = Column(Float)
    DSR_STATUS = Column(String)
    DSR_POD_RECD = Column(String)
    DSR_TRANSMF_NO = Column(String)
    DSR_BOOKING_TIME = Column(Time)

    DSR_DOX = Column(String)
    LABEL_TYPE = Column(String)

    DSR_SERVICE_TAX = Column(Float)
    DSR_SPL_DISC = Column(Float)
    DSR_CONTENTS = Column(String)
    DSR_REMARKS = Column(String)
    DSR_VALUE = Column(Float)

    DSR_INVNO = Column(String)
    DSR_INVDATE = Column(Date)

    MOD_DATE = Column(Date)
    OFFICE_TYPE = Column(String)
    OFFICE_CODE = Column(String)
    DSR_REFNO = Column(String)
    MOD_TIME = Column(String)

    NODEID = Column(String)
    USERID = Column(String)
    TRANS_STATUS = Column(String)
    DSR_ACT_CUST_CODE = Column(String , index = True)

    DSR_MOBILE = Column(String)
    DSR_EMAIL = Column(String)
    DSR_NDX_PAPER = Column(String)
    DSR_PICKUP_TIME = Column(Time)

    VOLUMETRIC_WEIGHT = Column(Float)
    ACTUAL_WEIGHT = Column(Float)

    DSR_ID_NUM = Column(String)
    FR_DP_CODE = Column(String)
    BKG_PINCODE = Column(String)

    SOFTDATA_UPLOAD_DATE = Column(DateTime)

    BILL_TO_CUSTOMER_MOBILE_NUMBER = Column(String)
    BILL_TO_CUSTOMER_NAME = Column(String)
    BILL_TO_CUSTOMER_ADDRESS = Column(String)

    SENDER_MOBILE = Column(String)
    SENDER_NAME = Column(String)
    SENDER_ADDRESS = Column(String)
    SENDER_PIN = Column(String)

    RECEIVER_NAME = Column(String)
    RECEIVER_ADDRESS = Column(String)
    RECEIVER_PIN = Column(String)

    FOD_COD_AMT = Column(Float)

    CARRIER_NAME = Column(String)
    CARRIER_AWB = Column(String)

    FREIGHT_CHARGES = Column(Float)
    FOD_COD_CHARGES = Column(Float)
    VAS_CHARGES = Column(Float)
    RISK_SURCHAGES = Column(Float)

    IGST = Column(Float)
    CGST = Column(Float)
    SGST = Column(Float)

    TOTAL_AMOUNT = Column(Float)

    CASH_AMT = Column(Float)
    UPI_ONLINE_AMT = Column(Float)
    CREDIT_AMT = Column(Float)

    TRANSACTION_REF_NO = Column(String)

    PAYMENT_DATE = Column(Date)
    PI_NO = Column(String)
    PI_DATE = Column(Date)

    INVOICE_NO = Column(String)
    INVOICE_DATE = Column(Date)

    DESTINATION_BRANCH_NAME = Column(String)
    EDD_DATE = Column(Date)

    LAST_STATUS_DESCRIPTION = Column(String)
    DELIVERED_DATE = Column(Date)
    RECEIVED_BY = Column(String)

    RTO_RECEIPT_DATE = Column(Date)
    RTO_DELIVERY_DATE = Column(Date)

    DISPATCH_MENIFEST_NO = Column(String)
    DELIVERY_MENIFEST_NO = Column(String)

    POD_LINK = Column(String)
    SHPT_DOC_LINK = Column(String)

    FR_STATUS = Column(String)
    FR_CS_NAME = Column(String)
    FR_CS_REMARK = Column(String)
    FR_SALES_PERSON = Column(String)
    FR_OPS_PERSON = Column(String)
    FR_SALES_OPS_BILLING_REMARK = Column(String)

    __table_args__ = (
        UniqueConstraint("DSR_CNNO", "DSR_BOOKING_DATE"),
    )




class Invoice(Base):
    __tablename__ = "invoices"

    invoice_seq = Sequence('invoice_seq', start=1, increment=1, metadata=Base.metadata)

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_number = Column(String, unique=True, nullable=False, index=True, server_default=text("'INV-' || nextval('invoice_seq'::regclass)"))
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, index = True)
    client_name = Column(String)
   
    booking_count = Column(Integer)

    total_amount = Column(Float, nullable=False, default=0.0)
    pdf_url = Column(String)
    invoice_type = Column(String)
    created_at = Column(DateTime, default=datetime.now)

    frenchise_id = Column(Integer, ForeignKey("frenchise.id"), nullable=False , index = True)









class RatePlan(Base):
    """One plan per client. Upserted on save."""
    __tablename__ = "rate_plans"

    id         = Column(Integer, primary_key=True, autoincrement=True, index = True)
    client_id  = Column(Integer, nullable=False , index = True)  
    transport_type = Column(String(50), nullable=False , index = True)
    region = Column(String)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    slabs  = relationship(
        "RateSlab",
        back_populates="plan",
        cascade="all, delete-orphan",
        order_by="RateSlab.min_weight",
    )


class RateSlab(Base):
    """
    Weight band → rate.

    Example rows for a plan:
      min=0,   max=1,    rate=5.0   →  0–1 kg   ₹5/kg
      min=1,   max=2,    rate=8.0   →  1–2 kg   ₹8/kg
      min=2,   max=None, rate=12.0  →  2 kg+    ₹12/kg
    """
    __tablename__ = "rate_slabs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_id     = Column(Integer, ForeignKey("rate_plans.id", ondelete="CASCADE"), nullable=False, index = True)
    min_weight  = Column(Float, nullable=False)          # kg (inclusive)
    max_weight  = Column(Float, nullable=True)           # kg (exclusive); NULL = unlimited
    rate_per_kg = Column(Float, nullable=False)          # ₹ per kg within this band

    plan = relationship("RatePlan", back_populates="slabs")

    __table_args__ = (
        UniqueConstraint("plan_id", "min_weight", name="uq_plan_min_weight"),
    )



class TransportTypes(Base):
    __tablename__ = "transport_types"
    id = Column(Integer, primary_key=True, autoincrement=True , index = True)
    transport_type = Column(String(50), unique = True)



class GstPerClient(Base):
    __tablename__ = "gst_per_client"

    id = Column(Integer, primary_key=True, autoincrement=True , index = True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False , index = True)
    cgst = Column(Float , default = 9.0)
    sgst = Column(Float , default = 9.0)
    igst = Column(Float , default = 18.0)



class ClientLogins(Base):
    __tablename__ = "client_logins"

    id = Column(Integer, primary_key=True, autoincrement=True , index = True)
    name = Column(String)
    email = Column(String(255), unique=True, nullable=False, index=True )
    password = Column(String(255), nullable=False)
    is_disabled = Column(Boolean , default = False)
    frenchise_id = Column(Integer, ForeignKey("frenchise.id"), nullable=True , index = True)