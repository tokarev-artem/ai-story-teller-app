import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize clients
const region = process.env.REGION || 'us-east-1';
const s3Client = new S3Client({ region });

// Environment variables
const bucketName = process.env.BUCKET_NAME;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Request body is required' }),
      };
    }

    const requestBody = JSON.parse(event.body);
    let { key, operation, contentType, objectUrl } = requestBody;

    // Handle both formats for backward compatibility
    if (objectUrl && objectUrl.startsWith('s3://')) {
      // Parse the S3 URL to extract the key
      // Format: s3://bucket-name/path/to/file
      const s3Parts = objectUrl.replace('s3://', '').split('/');
      // Skip the bucket name as we use the environment variable
      key = s3Parts.slice(1).join('/');
      operation = operation || 'get'; // Default to 'get' operation
      console.log(`Parsed objectUrl ${objectUrl} to key ${key}`);
    }

    if (!key || !operation) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required parameters: key, operation' }),
      };
    }

    if (!['get', 'put'].includes(operation.toLowerCase())) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Operation must be either "get" or "put"' }),
      };
    }

    let url: string;
    const expiresIn = 3600; // URL expires in 1 hour

    if (operation.toLowerCase() === 'get') {
      const command = new GetObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      
      url = await getSignedUrl(s3Client, command, { expiresIn });
    } else {
      // For 'put' operation
      if (!contentType) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'contentType is required for put operation' }),
        };
      }
      
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        ContentType: contentType,
      });
      
      url = await getSignedUrl(s3Client, command, { expiresIn });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        url,
        expires: new Date(Date.now() + expiresIn * 1000).toISOString(),
      }),
    };
  } catch (error: any) {
    console.error('Error generating presigned URL:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to generate presigned URL', details: error.message || String(error) }),
    };
  }
};
