import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

// Initialize clients
const region = process.env.REGION || 'us-east-1';
const bedrockClient = new BedrockRuntimeClient({ region });
const s3Client = new S3Client({ region });
const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const bucketName = process.env.BUCKET_NAME;
const tableName = process.env.TABLE_NAME;
const modelId = process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

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
    const { childName, age, theme, length, userId } = requestBody;

    if (!childName || !theme || !userId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing required parameters: childName, theme, userId' }),
      };
    }

    // Generate a unique ID for the story
    const storyId = uuidv4();
    const timestamp = new Date().toISOString();

    // Generate the story using Bedrock
    const storyText = await generateStory(childName, age, theme, length);
    
    // Store the story text in S3. This will trigger the downstream Lambdas.
    const textKey = `stories/${storyId}/story.txt`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: textKey,
        Body: storyText,
        ContentType: 'text/plain',
        Metadata: {
          'story-id': storyId, // Pass storyId in metadata for triggers
        },
      })
    );

    // Store metadata in DynamoDB
    const storyItem = {
      id: storyId,
      userId,
      childName,
      theme,
      age: age || 'unknown',
      title: extractTitle(storyText),
      textUrl: `s3://${bucketName}/${textKey}`,
      imageStatus: 'pending',
      audioStatus: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: storyItem,
      })
    );

    return {
      statusCode: 202, 
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        storyId,
        message: 'Story generation initiated. Please poll for status.',
      }),
    };
  } catch (error: any) {
    console.error('Error initiating story generation:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Failed to initiate story generation', details: error.message }),
    };
  }
};

async function generateStory(childName: string, age: number, theme: string, length: string): Promise<string> {
  console.log('Generating story with parameters:', { childName, age, theme, length });
  
  const prompt = `
  You are a professional children's bedtime story writer. Write an engaging, age-appropriate bedtime story for ${childName}, a ${age} year old.
  
  Story requirements:
  - Theme: ${theme}
  - Length: ${length} words
  - Include a title at the beginning
  - Make the main character named ${childName}
  - Include a moral lesson appropriate for the child's age
  - Use simple language that a child would understand
  - Create a cozy, calming story perfect for bedtime
  - End with a gentle conclusion that encourages sleep
  
  Format the story with a title at the top, followed by the story text. Do not include any additional commentary.
  `;

  console.log('Using Bedrock model:', modelId);
  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  };
  
  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });
  
  try {
    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.content[0].text;
  } catch (error) {
    console.error('Bedrock invocation error:', error);
    throw error;
  }
}

// Helper function to extract title from the story text
function extractTitle(storyText: string): string {
  const titleMatch = storyText.match(/^Title: (.*)/m);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1];
  }
  // Fallback if no "Title:" prefix is found, take the first line.
  return storyText.split('\n')[0].trim();
}
