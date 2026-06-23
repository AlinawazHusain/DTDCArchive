import aioboto3
from botocore.config import Config
from fastapi import UploadFile
import os
from dotenv import load_dotenv

load_dotenv()


ACC_KEY = os.environ.get("AWS_ACCESS_KEY")
SEC_KEY = os.environ.get("AWS_SECRET_KEY")
region = "ap-south-1"

SESSION = aioboto3.Session(
    aws_access_key_id=ACC_KEY,
    aws_secret_access_key=SEC_KEY,
    region_name=region
)

BUCKET = "mycoorierinvoices"

async def upload_inv_to_railway(file_obj, filename):
    async with SESSION.client("s3") as s3:
        await s3.upload_fileobj(
            Fileobj=file_obj,
            Bucket=BUCKET,
            Key=filename
            
        )
       
    file_url = f"https://{BUCKET}.s3.{region}.amazonaws.com/{filename}"
    return file_url





async def upload_file_to_railway(file: UploadFile, filename: str , is_client = True) -> str:
    bucket_name = "myclientsdata" if is_client else "myfrenchisedata"
    async with SESSION.client("s3") as s3:
        await s3.upload_fileobj(
            Fileobj=file.file,
            Bucket=bucket_name,
            Key=filename
            )

    file_url = f"https://{bucket_name}.s3.{region}.amazonaws.com/{filename}"
    return file_url

