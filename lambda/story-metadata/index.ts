import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Initialize clients
const region = process.env.REGION || 'us-east-1';
const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const tableName = process.env.TABLE_NAME;
const presignedUrlFunctionName = process.env.PRESIGNED_URL_FUNCTION_NAME || 'presigned-url';

// Function to get presigned URL by invoking the presigned-url Lambda
async function getPresignedUrl(s3Uri: string, operation: 'get' | 'put'): Promise<string> {
  const lambdaClient = new LambdaClient({ region: process.env.REGION || 'us-east-1' });
  const payload = {
    s3Uri,
    operation,
    expiresIn: 3600 // URL expires in 1 hour
  };
  const command = new InvokeCommand({
    FunctionName: process.env.PRESIGNED_URL_FUNCTION_NAME,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload)
  });
  const response = await lambdaClient.send(command);
  const responsePayload = JSON.parse(Buffer.from(response.Payload).toString());
  if (response.FunctionError) {
    throw new Error(`Error invoking presigned-url Lambda: ${response.FunctionError} - ${JSON.stringify(responsePayload)}`);
  }
  return responsePayload.presignedUrl;
}

// Function to enhance story with presigned URLs
async function enhanceStoryWithPresignedUrls(story: any): Promise<any> {
  if (!story) return story;
  const enhancedStory = { ...story };
  try {
    if (story.audioUrl && story.audioUrl.startsWith('s3://')) {
      console.log(`Generating presigned URL for audio: ${story.audioUrl}`);
      enhancedStory.audioUrl = await getPresignedUrl(story.audioUrl, 'get');
    }
    if (story.imageUrl && story.imageUrl.startsWith('s3://')) {
      console.log(`Generating presigned URL for image: ${story.imageUrl}`);
      enhancedStory.imageUrl = await getPresignedUrl(story.imageUrl, 'get');
    }
  } catch (error) {
    console.error('Error enhancing story with presigned URLs:', error);
  }
  return enhancedStory;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Check if we're getting a specific story by ID
    if (event.pathParameters && event.pathParameters.storyId) {
      const storyId = event.pathParameters.storyId;
      
      const result = await docClient.send(
        new GetCommand({
          TableName: tableName,
          Key: { id: storyId },
        })
      );

      if (!result.Item) {
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ error: 'Story not found' }),
        };
      }

      // Enhance the story with presigned URLs
      const enhancedStory = await enhanceStoryWithPresignedUrls(result.Item);

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(enhancedStory),
      };
    }
    
    // Otherwise, get stories for a user
    const queryParams = event.queryStringParameters || {};
    const userId = queryParams.userId;
    
    if (!userId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'userId query parameter is required' }),
      };
    }
    
    let stories = [];
    try {
      const queryResult = await docClient.send(
        new QueryCommand({
          TableName: tableName,
          IndexName: 'userIdIndex2',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
        })
      );
      stories = queryResult.Items || [];
    } catch (queryError) {
      console.error('Error querying with index, falling back to scan:', queryError);
      // Fallback to scan if index doesn't exist
      const scanResult = await docClient.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
        })
      );
      stories = scanResult.Items || [];
    }
    
    // Enhance all stories with presigned URLs
    const enhancedStories = await Promise.all(
      stories.map(story => enhanceStoryWithPresignedUrls(story))
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(enhancedStories),
    };
  } catch (error) {
    console.error('Error handling request:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
