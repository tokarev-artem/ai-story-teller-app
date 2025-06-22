import { SNSHandler, SNSEvent } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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
const modelId = 'amazon.titan-image-generator-v2:0';

type ImageGenerationParams = {
  prompt: string;
  storyId: string;
  style?: string;
};

export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  for (const record of event.Records) {
    let storyId: string | undefined;
    try {
      const snsMessage = JSON.parse(record.Sns.Message);
      // S3 event notification structure from SNS
      const s3Event = snsMessage.Records[0];
      if (!s3Event || s3Event.eventSource !== 'aws:s3' || s3Event.eventName.indexOf('ObjectCreated') === -1) {
        console.log(`Skipping non-S3 ObjectCreated event:`, s3Event);
        continue;
      }
      const bucketName = s3Event.s3.bucket.name;
      const objectKey = s3Event.s3.object.key;

      const keyParts = objectKey.split('/');
      if (keyParts.length !== 3 || keyParts[0] !== 'stories' || keyParts[2] !== 'story.txt') {
        console.log(`Skipping object with key ${objectKey} as it does not match the expected format.`);
        continue;
      }
      storyId = keyParts[1];

      const storyData = await docClient.send(
        new GetCommand({
          TableName: tableName!,
          Key: { id: storyId },
        })
      );

      if (!storyData.Item) {
        throw new Error(`Story with ID ${storyId} not found in DynamoDB.`);
      }

      const { childName, theme, title } = storyData.Item;
      const prompt = `Create a colorful, child-friendly illustration for a bedtime story titled "${title}" about ${theme}. The main character is named ${childName}. Make it dreamy and suitable for a children's book cover. Use soft colors and a warm, comforting style.`;

      console.log('Generated image prompt:', prompt);

      const imageBytes = await generateImage(bedrockClient, prompt);

      const imageKey = `stories/${storyId}/cover.png`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName!,
          Key: imageKey,
          Body: imageBytes,
          ContentType: 'image/png',
        })
      );

      await docClient.send(
        new UpdateCommand({
          TableName: tableName!,
          Key: { id: storyId },
          UpdateExpression: 'set imageUrl = :imageUrl, imageStatus = :status, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':imageUrl': `s3://${bucketName}/${imageKey}`,
            ':status': 'complete',
            ':updatedAt': new Date().toISOString(),
          },
        })
      );

      console.log(`Successfully generated image for story ID: ${storyId}`);

    } catch (error: any) {
      console.error('Error in generateImage:', error);
      console.error(`Error processing story ID ${storyId || 'unknown'}:`, error);
      if (storyId) {
        await docClient.send(new UpdateCommand({
          TableName: tableName!,
          Key: { id: storyId },
          UpdateExpression: 'set imageStatus = :status, updatedAt = :updatedAt',
          ExpressionAttributeValues: {
            ':status': 'error',
            ':updatedAt': new Date().toISOString(),
          },
        }));
      }
    }
  }
};

async function generateImage(bedrockClient: BedrockRuntimeClient, prompt: string): Promise<Uint8Array> {
  try {
    const body = JSON.stringify({
      taskType: "TEXT_IMAGE",
      textToImageParams: {
        text: prompt,
      },
      imageGenerationConfig: {
        numberOfImages: 1,
        quality: "standard",
        height: 1024,
        width: 1024,
        cfgScale: 8.0,
        seed: Math.floor(Math.random() * 100000),
      },
    });

    console.log('Request body for Bedrock:', body);

    const command = new InvokeModelCommand({
      modelId: 'amazon.titan-image-generator-v2:0',
      contentType: 'application/json',
      body: body,
    });

    const response = await bedrockClient.send(command);

    // Read the stream and convert to a string
    const responseBody = await response.body.transformToString();
    const parsedBody = JSON.parse(responseBody);

    // Extract the base64 image from the response
    const base64Image = parsedBody.images[0];

    // Convert base64 to Uint8Array (or Buffer in Node.js)
    return Uint8Array.from(Buffer.from(base64Image, 'base64'));

  } catch (error) {
    console.error('Error in generateImage:', error);
    throw error;
  }
}
