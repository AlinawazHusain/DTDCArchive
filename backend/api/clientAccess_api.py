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
from sqlalchemy import desc 
from collections import defaultdict
from sqlalchemy import select



client_access_router = APIRouter()




@client_access_router.get("/clientAccess/bookings/filter")
async def bookings(date_from: Optional[datetime.date] = None,
                    date_to:Optional[datetime.date] = None,
                    dsr_cnno : Optional[str] = None,
                    db: AsyncSession = Depends(get_async_db) ,
                    user=Depends(verify_token)):
    result = await db.execute(
        select(Clients).where(Clients.email == user["email"])
    )
    db_user = result.scalar_one_or_none()

    if not db_user:
        return {"bookings": []}

    if not db_user.frenchise_id:
        raise HTTPException(status_code=400, detail="User has no franchise assigned")
    

    query = select(DSRRecord).where(
        DSRRecord.frenchise_id == db_user.frenchise_id
    )
    query = query.where(DSRRecord.DSR_ACT_CUST_CODE == db_user.dsr_act_cust_code)
    

    if date_from and date_to:
        query = query.where(DSRRecord.DSR_BOOKING_DATE.between(date_from, date_to))

    elif date_from:
        query = query.where(DSRRecord.DSR_BOOKING_DATE >= date_from)

    elif date_to:
        query = query.where(DSRRecord.DSR_BOOKING_DATE <= date_to)
    
    if dsr_cnno:
        query = query.where(DSRRecord.DSR_CNNO == dsr_cnno)

    # 👉 ordering
    query = query.order_by(desc(DSRRecord.id))

    result = await db.execute(query)

    all_bookings = result.scalars().all()

    COLUMNS = [
    "id",
    "DSR_CNNO",
    "DSR_BOOKING_DATE",
    "DSR_DEST",
    "DSR_DEST_PIN",
    "DESTINATION_BRANCH_NAME",
    "EDD_DATE",
    "RECEIVER_NAME",
    "DSR_MOBILE",
    "FR_STATUS",
    "FR_CS_REMARK",
    "FR_CS_NAME",
    ]

    bookings_list = [
        {
            col: (
                getattr(b, col).isoformat()
                if hasattr(getattr(b, col, None), "isoformat")
                else getattr(b, col, None)
            )
            for col in COLUMNS
        }
        for b in all_bookings
    ]
    return {"bookings": bookings_list}










@client_access_router.put("/clientAccess/bookingUpdate")
async def bookingsUpdate(data:dict,
                    db: AsyncSession = Depends(get_async_db) ,
                    user=Depends(verify_token)):
    query = select(DSRRecord).where(
        DSRRecord.id == data["id"]
    )

    result = await db.execute(query)

    booking = result.scalar_one_or_none()

    if not booking:
        raise HTTPException(status_code=404, detail="No bookign find with this booking")
    
    col_map = {
        "FR_STATUS":  data["FR_STATUS"],
        "FR_CS_REMARK": data["FR_CS_REMARK"],
        "FR_CS_NAME": data["FR_CS_NAME"]
    }

    for k , v in col_map:
        setattr(booking, k, v)

    await db.flush()
    await db.commit()
    await db.refresh(booking)
    col_map["id"] = data["id"]

    return {"data": col_map}