import { S3Handler } from 'aws-lambda';
import { uploadUserFile } from './s3Handler';

export const main: S3Handler = async (event) => {
  return uploadUserFile(event);
};
