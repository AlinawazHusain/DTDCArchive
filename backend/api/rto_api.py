import datetime
from typing import Any, Optional

from gst_calc_utils import calculate_final_amount, get_state_from_pincode
from sqlalchemy.future import select
from fastapi import APIRouter , Depends , HTTPException, status
from pydantic import BaseModel
from db.tables import Clients, GstPerClient, RatePlan, RateSlab,  Users , DSRRecord
from sqlalchemy.ext.asyncio import AsyncSession
from db.db import  get_async_db
from utils import  coerce_value, verify_token
from sqlalchemy import desc , and_
from collections import defaultdict
from sqlalchemy import select



rto_router = APIRouter()


# ── GET /api/rto/bookings/filter ──────────────────────────────────────────────
@rto_router.get("/rto/bookings/filter")
async def rto_filter(
    cnno:      Optional[str]  = None,
    date_from: Optional[datetime.date] = None,
    date_to:   Optional[datetime.date] = None,
    client_id: Optional[int]  = None,
    status:    Optional[str]  = None,
    db: AsyncSession = Depends(get_async_db),
    user = Depends(verify_token),
):
    result = await db.execute(select(Users).where(Users.email == user["email"]))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    filters = [DSRRecord.frenchise_id == db_user.frenchise_id]

    if cnno:
        filters.append(DSRRecord.DSR_CNNO.ilike(f"%{cnno.strip()}%"))
    if date_from:
        filters.append(DSRRecord.DSR_BOOKING_DATE >= date_from)
    if date_to:
        filters.append(DSRRecord.DSR_BOOKING_DATE <= date_to)
    if status:
        filters.append(DSRRecord.DSR_STATUS == status)

    if client_id:
        # get all act_cust_codes belonging to this client
        client = await db.get(Clients, client_id)
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        filters.append(DSRRecord.DSR_ACT_CUST_CODE == client.dsr_act_cust_code)

    stmt = select(DSRRecord).where(and_(*filters)).order_by(DSRRecord.DSR_BOOKING_DATE.desc())
    result = await db.execute(stmt)
    records = result.scalars().all()

    return [
        {
            k: (v.isoformat() if hasattr(v, "isoformat") else v)
            for k, v in r.__dict__.items()
            if not k.startswith("_")
        }
        for r in records
    ]


# ── PUT /api/rto/bookingUpdate ────────────────────────────────────────────────
class RTOUpdatePayload(BaseModel):
    id:                int
    RTO_RECEIPT_DATE:  Optional[datetime.date] = None
    RTO_DELIVERY_DATE: Optional[datetime.date] = None
    RECEIVED_BY:       Optional[str]  = None
    POD_LINK:          Optional[str]  = None

class RTOUpdateRequest(BaseModel):
    data: RTOUpdatePayload

@rto_router.put("/rto/bookingUpdate")
async def rto_update(
    payload: RTOUpdateRequest,
    db: AsyncSession = Depends(get_async_db),
    user = Depends(verify_token),
):
    result = await db.execute(select(Users).where(Users.email == user["email"]))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    record = await db.get(DSRRecord, payload.data.id)
    if not record:
        raise HTTPException(status_code=404, detail="Booking not found")

    # ensure franchise can only update its own records
    if record.frenchise_id != db_user.frenchise_id:
        raise HTTPException(status_code=403, detail="Access denied")

    record.RTO_RECEIPT_DATE  = payload.data.RTO_RECEIPT_DATE
    record.RTO_DELIVERY_DATE = payload.data.RTO_DELIVERY_DATE
    record.RECEIVED_BY       = payload.data.RECEIVED_BY  or record.RECEIVED_BY
    record.POD_LINK          = payload.data.POD_LINK     or record.POD_LINK

    await db.commit()
    await db.refresh(record)

    return {
        "message": f"Booking {record.DSR_CNNO} updated successfully.",
        "data": {
            k: (v.isoformat() if hasattr(v, "isoformat") else v)
            for k, v in record.__dict__.items()
            if not k.startswith("_")
        }
    }




class RTOBulkUpdatePayload(BaseModel):
    data: list[dict[str, Any]]


def parse_date(val: Optional[str]) -> Optional[datetime.date]:
    if not val or not val.strip():
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(val.strip(), fmt).date()
        except ValueError:
            continue
    return None

@rto_router.post("/rto/bulkUpdate")
async def bookingUpload(
    payload: RTOBulkUpdatePayload,
    db: AsyncSession = Depends(get_async_db),
    user = Depends(verify_token)
):
    
    result = await db.execute(
        select(Users).where(Users.email == user["email"])
    )
    db_user = result.scalar_one_or_none()

    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if not db_user.frenchise_id:
        raise HTTPException(status_code=400, detail="User has no franchise assigned")
    

    dsr_nums = [i.get('CnNo') for i in payload.data]

    query = select(DSRRecord).where(
        and_(
            DSRRecord.frenchise_id == db_user.frenchise_id,
            DSRRecord.DSR_CNNO.in_(dsr_nums),
        )
    )
    result = await db.execute(query)
    rows_to_update = result.scalars().all()

    record_map = {r.DSR_CNNO: r for r in rows_to_update}

    success = 0
    errors  = []

    for i in payload.data:
        record = record_map.get(i.get('CnNo'))

        if not record:
            errors.append({"cnno": i.get('CnNo'), "message": "Not found"})
            continue

        if record.DSR_REFNO != i.get('RefNo'):      # ← correct casing
            errors.append({"cnno": i.get('CnNo'), "message": "RefNo mismatch"})
            continue
        recept_date = i.get('RTO_RECEIPT_DATE')
        delievery_date = i.get('RTO_DELIVERY_DATE')
        rec_name = i.get('RECEIVER_NAME')
        if recept_date:
            record.RTO_RECEIPT_DATE  = parse_date(recept_date)
        
        if delievery_date:
            record.RTO_DELIVERY_DATE = parse_date(delievery_date)

        if rec_name:
            record.RECEIVER_NAME     = rec_name
        success += 1

    await db.commit()   # one single commit — all updates flush here

    return {"success": success, "failed": len(errors), "errors": errors}