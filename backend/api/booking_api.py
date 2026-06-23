import datetime
from typing import Any, Optional

from gst_calc_utils import calculate_final_amount, get_state_from_pincode
from sqlalchemy.future import select
from fastapi import APIRouter , Depends , HTTPException, status
from pydantic import BaseModel
from db.tables import Clients, Frenchise, GstPerClient, Invoice, RatePlan, RateSlab,  Users , DSRRecord
from sqlalchemy.ext.asyncio import AsyncSession
from db.db import  get_async_db
from utils import  coerce_value, parse_date, verify_token
from sqlalchemy import desc , delete, update
from sqlalchemy.orm import selectinload
from collections import defaultdict
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select , or_ , and_
from sqlalchemy import case, update
from sqlalchemy import func
from sqlalchemy import String, Text
from sqlalchemy import String, Text, Integer, Numeric, Float

from collections import defaultdict

from sqlalchemy import select



booking_router = APIRouter()




@booking_router.get("/bookings/filter")
async def bookings(client_id: Optional[int] = None,
                    date_from: Optional[datetime.date] = None,
                    date_to:Optional[datetime.date] = None,
                    dsr_cnno : Optional[str] = None,
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
    

    query = select(DSRRecord).where(
        DSRRecord.frenchise_id == db_user.frenchise_id
    )

    client_name_map = {}


    if client_id:
        client_data = await db.execute(
            select(Clients)
            .where(Clients.id == client_id)
        )
        client_data = client_data.scalar_one_or_none()

        if not client_data:
            raise HTTPException(status_code=404, detail="Client not found")
        
        client_name_map = {
            client_data.dsr_act_cust_code: client_data.name,
            client_data.phone_number: client_data.name
            }


        query = query.where(or_(
                        DSRRecord.DSR_ACT_CUST_CODE == client_data.dsr_act_cust_code,
                        DSRRecord.DSR_CUST_CODE == client_data.phone_number
                    ))


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

    if not client_id:
        codes = {b.DSR_ACT_CUST_CODE for b in all_bookings if b.DSR_ACT_CUST_CODE}
        pnums = {b.DSR_CUST_CODE for b in all_bookings if b.DSR_CUST_CODE}

        if codes or pnums:
            client_result = await db.execute(
                select(Clients).where(
                    or_(
                        Clients.dsr_act_cust_code.in_(codes) if codes else False,
                        Clients.phone_number.in_(pnums) if pnums else False
                    )
                )
            )
            # client_result = await db.execute(
            #     select(Clients).where(Clients.dsr_act_cust_code.in_(codes))
            # )
            clients = client_result.scalars().all()

            # map: code -> name
            for c in clients:
                if c.dsr_act_cust_code:
                    client_name_map[c.dsr_act_cust_code] = c.name
                if c.phone_number:
                    client_name_map[c.phone_number] = c.name
            # client_name_map = {
            #     c.dsr_act_cust_code: c.name for c in clients
            # }


    bookings_list = [
    {
        **{
            k: (v.isoformat() if hasattr(v, "isoformat") else v)
            for k, v in b.__dict__.items()
            if not k.startswith("_")
        },
        # "client_name": client_name_map.get(b.DSR_ACT_CUST_CODE)
        "client_name": (
            client_name_map.get(b.DSR_ACT_CUST_CODE)
            or client_name_map.get(b.DSR_CUST_CODE)
        )
    }
    for b in all_bookings
]
    return {"bookings": bookings_list}

    


class BookingUploadPayload(BaseModel):
    data: list[dict[str, Any]]


def preserve_existing(table_col, excluded_col):
    """
    Keep DB value only if it's truly filled:
    - Strings:  non-null AND non-empty ('')
    - Numbers:  non-null AND non-zero (0 / 0.0)
    - Others:   non-null only
    """
    if isinstance(table_col.type, (String, Text)):
        # Treat NULL and '' as empty
        return func.coalesce(func.nullif(table_col, ""), excluded_col)
    
    elif isinstance(table_col.type, (Integer, Float, Numeric)):
        # Treat NULL and 0/0.0 as empty
        return func.coalesce(func.nullif(table_col, 0), excluded_col)
    
    else:
        # Date, Boolean, etc. — only fill if NULL
        return func.coalesce(table_col, excluded_col)


@booking_router.post("/bookingUpload")
async def bookingUpload(
    payload: BookingUploadPayload,
    db: AsyncSession = Depends(get_async_db),
    user = Depends(verify_token)
):
    # ---------------- USER VALIDATION ----------------
    result = await db.execute(select(Users).where(Users.email == user["email"]))
    db_user = result.scalar_one_or_none()

    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if not db_user.frenchise_id:
        raise HTTPException(status_code=400, detail="User has no franchise assigned")

    frenchise_id = db_user.frenchise_id

    if not payload.data:
        return {"message": "No data provided", "saved": []}




    # # ---------------- COLUMN MAP ----------------
    col_map = {c.key: c for c in DSRRecord.__table__.columns}

    rows_to_insert = []
    # # ---------------- MAIN LOOP ----------------
    for row in payload.data:
        normalized = {k.upper(): v for k, v in row.items()}

        filtered = {}
        for k, v in normalized.items():
            if k in col_map:
                filtered[k] = coerce_value(col_map[k], v)

        filtered["frenchise_id"] = frenchise_id
        filtered["CHARGEABLE_WEIGHT"] = row.get("CHARGEABLE WEIGHT" , 0.0)
        filtered["VOLUMETRIC_WEIGHT"] = row.get("VOLUMETRIC WEIGHT" , 0.0)
        filtered["ACTUAL_WEIGHT"] = row.get("ACTUAL WEIGHT" , 0.0)

        cleaned = {k: (v if v != "" else None) for k, v in filtered.items()}
        rows_to_insert.append(cleaned)

    # ---------------- COMMIT ----------------
    if not rows_to_insert:
        return {"message": "No valid rows", "data": []}


    BATCH_SIZE = 500  # safe (you can try 1000 later)

    columns = DSRRecord.__table__.columns.keys()
    table_cols = DSRRecord.__table__.c 

    for i in range(0, len(rows_to_insert), BATCH_SIZE):
        batch = rows_to_insert[i:i + BATCH_SIZE]

        stmt = insert(DSRRecord).values(batch)

        update_dict = {
            k: preserve_existing(table_cols[k], getattr(stmt.excluded, k))
            # k: getattr(stmt.excluded, k)
            for k in columns
            if k not in ["DSR_CNNO", "DSR_BOOKING_DATE"]
        }

        stmt = stmt.on_conflict_do_update(
            index_elements=["DSR_CNNO", "DSR_BOOKING_DATE"],
            set_=update_dict
        )

        await db.execute(stmt)

    await db.commit()


    
    # stmt = insert(DSRRecord).values(rows_to_insert)
    # columns = DSRRecord.__table__.columns.keys()

    # update_dict = {
    #     k: getattr(stmt.excluded, k)
    #     for k in columns
    #     if k not in ["DSR_CNNO", "DSR_BOOKING_DATE"]
    # }

    # stmt = stmt.on_conflict_do_update(
    #     index_elements=["DSR_CNNO", "DSR_BOOKING_DATE"],
    #     set_=update_dict
    # )

    # await db.execute(stmt)
    # await db.commit()



    return {
        "message": f"{len(rows_to_insert)} records processed successfully.",
        "count": len(rows_to_insert)
    }


class BookingUpdatePayload(BaseModel):
    data: dict[str, Any]


@booking_router.put("/bookingUpdate")
async def bookingUpdate(payload: BookingUpdatePayload, db: AsyncSession = Depends(get_async_db), user=Depends(verify_token)):
    if not payload.data:
        return {"message": "No data provided", "updated": []}

    col_map = {c.key: c for c in DSRRecord.__table__.columns}

    row_id = None
    normalized = {}
    for k, v in payload.data.items():
        if k.lower() == 'id':
            row_id = v
        else:
            normalized[k.upper()] = v

    if not row_id:
        raise HTTPException(status_code=400, detail="id is required")

    existing = await db.execute(
        select(DSRRecord).where(DSRRecord.id == row_id)
    )
    record = existing.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=404, detail=f"Record with id {row_id} not found")

    for k, v in normalized.items():
        if k in col_map:
            setattr(record, k, coerce_value(col_map[k], v))

    await db.flush()
    await db.commit()
    await db.refresh(record)

    response_row = {
        k: (v.isoformat() if hasattr(v, "isoformat") else v)
        for k, v in record.__dict__.items()
        if not k.startswith("_")
    }

    return {
        "message": "Record updated successfully.",
        "data": response_row
    }




def isvalid_pincode(pincode: str) -> bool:
    # Check if length is 6
    if len(pincode) != 6:
        return False
    
    # Check if all characters are digits
    if not pincode.isdigit():
        return False
    
    # Check if it starts with 0
    if pincode[0] == '0':
        return False
    
    return True



@booking_router.post("/addBooking")
async def add_booking(
    payload: dict, 
    db: AsyncSession = Depends(get_async_db),
    user: Users = Depends(verify_token)
):
    result = await db.execute(
        select(Users).where(Users.email == user["email"])
    )
    db_user = result.scalar_one_or_none()

    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    if not db_user.frenchise_id:
        raise HTTPException(status_code=400, detail="User has no franchise assigned")
    
    frenchise_id = db_user.frenchise_id


    dsr_records_to_add = []
    client_id = payload["client_id"]
    bookings = payload["bookings"]
    booking_date = parse_date(payload["booking_date"])

    
    client = await db.get(Clients, client_id)
 


    for booking in bookings:
        # Skip invalid DSR_CNNO
        if not booking.get("DSR_CNNO"):
            continue


        record = {
            "frenchise_id" : frenchise_id,
            "DSR_CUST_CODE" : client.dsr_act_cust_code,
            "DSR_ACT_CUST_CODE" : client.dsr_act_cust_code,
            "DSR_CNNO" : booking.get("DSR_CNNO"),
            "DSR_MODE" : booking.get("DSR_MODE") or "",

            "BKG_PINCODE" : booking.get("BKG_PINCODE") or "",
            "DSR_REFNO" : booking.get("DSR_REF_NO") or "",
            "CHARGEABLE_WEIGHT" : float(booking.get("CHARGEABLE_WEIGHT") or 0.0),
            "RECEIVER_NAME" : booking.get("RECEIVER_NAME") or "",
            "RECEIVER_PIN" : booking.get("RECEIVER_PIN") or "",
            "CASH_AMT" : float(booking.get("CASH_AMOUNT") or 0.0),
            "UPI_ONLINE_AMT" : float(booking.get("UPI_ONLINE_AMOUNT") or 0.0),
            "CREDIT_AMT" : float(booking.get("CREDIT_AMOUNT") or 0.0),
            "TRANSACTION_REF_NO" : booking.get("TRANSACTION_REFNO") or "",
            "PAYMENT_DATE" : booking.get("PAYMENT_DATE"),


            "DSR_REMARKS" : booking.get("REMARK") or "",
            "DSR_BOOKING_DATE" : booking_date,
            "SOFTDATA_UPLOAD_DATE" : datetime.datetime.now()
        }

        dsr_records_to_add.append(record)

    if not dsr_records_to_add:
        raise HTTPException(status_code=400, detail="No valid DSR records to insert")
    
  
    
    stmt = insert(DSRRecord).values(dsr_records_to_add)

    update_dict = {
        k: getattr(stmt.excluded, k)
        for k in dsr_records_to_add[0].keys()
        if k not in ["DSR_CNNO", "DSR_BOOKING_DATE"]
    }

    stmt = stmt.on_conflict_do_update(
        index_elements=["DSR_CNNO", "DSR_BOOKING_DATE"],
        set_=update_dict
    )

    await db.execute(stmt)
    await db.commit()


    return {"message": f"{len(dsr_records_to_add)} DSR records added successfully."}



@booking_router.delete("/deleteBooking")
async def delete_booking(
    payload: dict, 
    db: AsyncSession = Depends(get_async_db),
    user: Users = Depends(verify_token)
):
    booking_id = payload.get("id")
    if not booking_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Booking ID is required"
        )

    # Perform delete
    stmt = delete(DSRRecord).where(DSRRecord.id == booking_id)
    result = await db.execute(stmt)

    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Booking not found"
        )

    await db.commit()
    return {"status": "Success", "deleted_id": booking_id}




class BulkUpdateWeightRequest(BaseModel):
    data: list[dict[str , Any]]


@booking_router.post("/bookings/bulkUpdateWeight")
async def add_booking(
    payload: BulkUpdateWeightRequest, 
    db: AsyncSession = Depends(get_async_db),
    user: Users = Depends(verify_token)
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
        chargable_weight = i.get('CHARGEABLE_WEIGHT' , 0.0)
        

        if chargable_weight and chargable_weight != 0.0:
            record.CHARGEABLE_WEIGHT = float(chargable_weight)

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






class syncWithSlabRequest(BaseModel):
    client_id : int
    dsr_ids : list[int]


@booking_router.put("/syncBookingWithSlab")
async def syncBookingsWithSlabs(payload : syncWithSlabRequest ,
                                db: AsyncSession = Depends(get_async_db),
                                user: Users = Depends(verify_token)
                                ):
    
    client_id = payload.client_id
    client = await db.get(Clients, client_id)
    
    cli_gsts = await db.execute(select(GstPerClient).where(GstPerClient.client_id == client_id))
    gsts = cli_gsts.scalar_one_or_none()

    if not gsts:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No GST Set for this client , Setup GST in Rates"
        )

    rplans = await db.execute(select(RatePlan).where(RatePlan.client_id == client_id))
    rplans = rplans.scalars().all()
    rplans_ids = [p.id for p in rplans]

    stmt = (
        select(RateSlab, RatePlan.transport_type)
        .join(RatePlan, RateSlab.plan_id == RatePlan.id)
        .where(RateSlab.plan_id.in_(rplans_ids))
    )

    result = await db.execute(stmt)
    rows = result.all()

    slabs_dict = defaultdict(list)

    for slab, transport_type in rows:
        key = transport_type.strip().lower() if transport_type else "unknown"
        slabs_dict[key].append([
            slab.min_weight,
            slab.max_weight,
            slab.rate_per_kg
        ])

    for ttype in slabs_dict:
        slabs_dict[ttype].sort(key=lambda x: x[0])

    slabs_dict = dict(slabs_dict)


    query = select(DSRRecord).where(
    DSRRecord.id.in_(payload.dsr_ids)
    )

    result = await db.execute(query)
    all_bookings = result.scalars().all()

    updates = []


    for booking in all_bookings:
        chargable_weight = float(booking.CHARGEABLE_WEIGHT)
        if chargable_weight == 0.0:
            raise HTTPException(
                status_code=404,
                detail=f"Booking {booking.id} have zero chargable weight , please setup for syncing"
            )
        
        ttype = booking.DSR_CN_TYPE
        if not ttype:
            raise HTTPException(
                status_code=400,
                detail=f"Booking {booking.id} have no DSR Mode , please configure"
            )

        
        ttype = ttype.strip().lower()

        slab = slabs_dict.get(ttype)
        if not slab:
            raise HTTPException(
                status_code=404,
                detail=f"No slab found for transport type: {ttype}"
            )

    #     # PINCODES
        client_pin = client.pincode
        dest_pin = booking.BKG_PINCODE or booking.DSR_DEST_PIN

        if not isvalid_pincode(client_pin):
            raise HTTPException(status_code=400, detail="This Client have Invalid pincode , please configure correct pincode ")
        if not isvalid_pincode(dest_pin):
            raise HTTPException(status_code=400, detail=f"Booking {booking.id} have invailid DSR DEST PIn or BKG PIN , please configure correct pincode ")


        client_state = get_state_from_pincode(client_pin)
        dest_state = get_state_from_pincode(dest_pin)

        within_state = client_state == dest_state
    #     # TAX %
        sgst_percent = gsts.sgst
        cgst_percent = gsts.cgst
        igst_percent = gsts.igst

        final_amounts = calculate_final_amount(
            sgst_percent,
            cgst_percent,
            igst_percent,
            chargable_weight,
            slab,
            within_state
        )

        updates.append({
            "id": booking.id,
            "CGST": final_amounts["cgst"],
            "SGST": final_amounts["sgst"],
            "IGST": final_amounts["igst"],
            "TOTAL_AMOUNT": final_amounts["total"],
        })

    ids = [u["id"] for u in updates]

    cgst_map = {u["id"]: u["CGST"] for u in updates}
    sgst_map = {u["id"]: u["SGST"] for u in updates}
    igst_map = {u["id"]: u["IGST"] for u in updates}
    total_map = {u["id"]: u["TOTAL_AMOUNT"] for u in updates}

    stmt = (
        update(DSRRecord)
        .where(DSRRecord.id.in_(ids))
        .values(
            CGST=case(cgst_map, value=DSRRecord.id),
            SGST=case(sgst_map, value=DSRRecord.id),
            IGST=case(igst_map, value=DSRRecord.id),
            TOTAL_AMOUNT=case(total_map, value=DSRRecord.id),
        )
    )

    await db.execute(stmt)
    await db.commit()
    
    return {"success" : True}