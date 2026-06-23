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
from sqlalchemy import desc , or_ , and_
from collections import defaultdict
from sqlalchemy import select



customer_support_router = APIRouter()




@customer_support_router.get("/customerSupport/bookings/filter")
async def bookings(client_id: Optional[int] = None,
                    date_from: Optional[datetime.date] = None,
                    date_to:Optional[datetime.date] = None,
                    fr_cs_name: Optional[str] = None,
                    fr_status : Optional[str] =  None,
                    dsr_cnno : Optional[str] = None,
                    db: AsyncSession = Depends(get_async_db) ,
                    user=Depends(verify_token)):
    query = select(DSRRecord)
    if dsr_cnno:
        query = query.where(
            DSRRecord.DSR_CNNO == dsr_cnno
        )
    
    else:

        result = await db.execute(
            select(Clients).where(Clients.id == client_id)
        )
        db_user = result.scalar_one_or_none()

        if db_user:
            if not db_user.frenchise_id:
                raise HTTPException(status_code=400, detail="User has no franchise assigned")
            

            query = query.where(
                DSRRecord.frenchise_id == db_user.frenchise_id
            )
            query = query.where(DSRRecord.DSR_ACT_CUST_CODE == db_user.dsr_act_cust_code)
        

        if date_from and date_to:
            query = query.where(DSRRecord.DSR_BOOKING_DATE.between(date_from, date_to))

        elif date_from and not date_to:
            query = query.where(DSRRecord.DSR_BOOKING_DATE >= date_from)

        elif date_to and not date_to:
            query = query.where(DSRRecord.DSR_BOOKING_DATE <= date_to)
    
        if fr_cs_name:
            query = query.where(DSRRecord.FR_CS_NAME == fr_cs_name)
        
        if fr_status:
            query = query.where(DSRRecord.FR_STATUS == fr_status)

    # 👉 ordering
    query = query.order_by(desc(DSRRecord.id))

    result = await db.execute(query)

    all_bookings = result.scalars().all()
    codes = {b.DSR_ACT_CUST_CODE for b in all_bookings if b.DSR_ACT_CUST_CODE}
    pnums = {b.DSR_CUST_CODE for b in all_bookings if b.DSR_CUST_CODE}
    client_name_map = {}
    if codes or pnums:
            client_result = await db.execute(
                select(Clients).where(
                    or_(
                        Clients.dsr_act_cust_code.in_(codes) if codes else False,
                        Clients.phone_number.in_(pnums) if pnums else False
                    )
                )
            )
            clients = client_result.scalars().all()

            # map: code -> name
            for c in clients:
                if c.dsr_act_cust_code:
                    client_name_map[c.dsr_act_cust_code] = c.name
                if c.phone_number:
                    client_name_map[c.phone_number] = c.name

    COLUMNS = [
    "id",
    "DSR_CNNO",
    "DSR_BOOKING_DATE",
    "DSR_DEST",
    "DSR_DEST_PIN",
    "DESTINATION_BRANCH_NAME",
    "EDD_DATE",
    "LAST_STATUS_DESCRIPTION",
    "RECEIVER_NAME",
    "DSR_MOBILE",
    "FR_STATUS",
    "FR_CS_REMARK",
    "FR_CS_NAME",
    ]
    bookings_list = []
    for b in all_bookings:
        this_booking = {
            col: (
                getattr(b, col).isoformat()
                if hasattr(getattr(b, col, None), "isoformat")
                else getattr(b, col, None)
            )
            for col in COLUMNS
        }
        this_booking["client_name"] = client_name_map.get(b.DSR_ACT_CUST_CODE) or client_name_map.get(b.DSR_CUST_CODE)

        bookings_list.append(this_booking)
    return {"bookings": bookings_list}










@customer_support_router.put("/customerSupport/bookingUpdate")
async def bookingsUpdate(data:dict,
                    db: AsyncSession = Depends(get_async_db) ,
                    user=Depends(verify_token)):
    data = data.get("data")
    query = select(DSRRecord).where(
        DSRRecord.id == data.get("id")
    )

    result = await db.execute(query)

    booking = result.scalar_one_or_none()

    if not booking:
        raise HTTPException(status_code=404, detail="No bookign find with this booking")
    
    col_map = {
        "FR_STATUS":  data["FR_STATUS"],
        "FR_CS_REMARK": data["FR_CS_REMARK"],
        "FR_CS_NAME": data["FR_CS_NAME"],
        "RECEIVER_NAME" : data["RECEIVER_NAME"],
        "DSR_MOBILE" : data["DSR_MOBILE"]
    }

    setattr(booking, "FR_STATUS", col_map["FR_STATUS"])
    setattr(booking, "FR_CS_REMARK", col_map["FR_CS_REMARK"])
    setattr(booking, "FR_CS_NAME", col_map["FR_CS_NAME"])
    setattr(booking, "RECEIVER_NAME", col_map["RECEIVER_NAME"])
    setattr(booking, "DSR_MOBILE", col_map["DSR_MOBILE"])

    await db.flush()
    await db.commit()
    await db.refresh(booking)
    col_map["id"] = data["id"]

    return {"data": col_map}




def parse_date(val: Optional[str]) -> Optional[datetime.date]:
    if not val or not val.strip():
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(val.strip(), fmt).date()
        except ValueError:
            continue
    return None

class CSBulkUpdatePayload(BaseModel):
    data: list[dict[str, Any]]


@customer_support_router.post('/customerSupport/bulkUpdate')
async def bulkUploadUpdate(payload:CSBulkUpdatePayload,
                    db: AsyncSession = Depends(get_async_db) ,
                    user=Depends(verify_token)):
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
        booking_date = i.get('booking_date')
        booking_date = parse_date(booking_date)
        if record.DSR_BOOKING_DATE != booking_date:      # ← correct casing
            errors.append({"cnno": i.get('CnNo'), "message": "Booking date mismatch"})
            continue

        edd_date = i.get('edd_date')
        rec_name = i.get('RECEIVER_NAME')
        dsr_mobile = i.get('DSR_MOBILE')
        destination_branch_name = i.get('destination_branch_name')
        last_status_description = i.get('last_status_description')

        if edd_date:
            record.EDD_DATE  = parse_date(edd_date)

        if rec_name:
            record.RECEIVER_NAME = rec_name
        
        if dsr_mobile:
            record.DSR_MOBILE = dsr_mobile
        
        if destination_branch_name:
            record.DESTINATION_BRANCH_NAME = destination_branch_name
        
        if last_status_description:
            record.LAST_STATUS_DESCRIPTION = last_status_description
        
        success += 1

    await db.commit()  

    return {"success": success, "failed": len(errors), "errors": errors}