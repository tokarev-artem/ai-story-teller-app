import { SNSEvent, SNSHandler } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PollyClient, SynthesizeSpeechCommand, SynthesizeSpeechCommandInput } from '@aws-sdk/client-polly';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Readable } from 'stream';

// Initialize clients
const region = process.env.REGION || 'us-east-1';
const s3Client = new S3Client({ region });
const pollyClient = new PollyClient({ region });
const dynamoClient = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Environment variables
const tableName = process.env.TABLE_NAME!;

// Helper function to convert a stream to a buffer
const streamToBuffer = (stream: Readable): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });

export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  console.log('Received SNS event:', JSON.stringify(event, null, 2));

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

    // Expecting key format: stories/{storyId}/story.txt
    const keyParts = objectKey.split('/');
    if (keyParts.length !== 3 || keyParts[0] !== 'stories' || keyParts[2] !== 'story.txt') {
      console.log(`Skipping object with key ${objectKey} as it does not match the expected format.`);
      continue;
    }

    storyId = keyParts[1];
      // 1. Get the story text from S3
      console.log(`Fetching story text from s3://${bucketName}/${objectKey}`);
      const getObjectCmd = new GetObjectCommand({ Bucket: bucketName, Key: objectKey });
      const getObjectResult = await s3Client.send(getObjectCmd);
      const storyText = await streamToBuffer(getObjectResult.Body as Readable);

      // 2. Synthesize audio using Polly
      console.log(`Synthesizing audio for story ID: ${storyId}`);
      const pollyParams: SynthesizeSpeechCommandInput = {
        Engine: 'long-form',
        OutputFormat: 'mp3',
        Text: storyText.toString('utf-8'),
        VoiceId: 'Ruth',
        TextType: 'text',
      };
      const pollyCmd = new SynthesizeSpeechCommand(pollyParams);
      const { AudioStream } = await pollyClient.send(pollyCmd);

      if (!AudioStream) {
        throw new Error('Polly did not return an audio stream.');
      }

      // 3. Save the audio file to S3
      const audioKey = `stories/${storyId}/audio.mp3`;
      console.log(`Uploading audio to s3://${bucketName}/${audioKey}`);
      const audioBuffer = await streamToBuffer(AudioStream as Readable);
      const putObjectCmd = new PutObjectCommand({
        Bucket: bucketName,
        Key: audioKey,
        Body: audioBuffer,
        ContentType: 'audio/mpeg',
      });
      await s3Client.send(putObjectCmd);

      // 4. Update DynamoDB with the audio URL
      console.log(`Updating DynamoDB for story ID: ${storyId}`);
      const updateCmd = new UpdateCommand({
        TableName: tableName,
        Key: { id: storyId },
        UpdateExpression: 'set audioUrl = :audioUrl, audioStatus = :status, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':audioUrl': `s3://${bucketName}/${audioKey}`,
          ':status': 'complete',
          ':updatedAt': new Date().toISOString(),
        },
      });
      await docClient.send(updateCmd);

      console.log(`Successfully processed audio for story ID: ${storyId}`);
    } catch (error: any) {
      console.error(`Error processing story ID ${storyId || 'unknown'}:`, error);
      if (storyId) {
        try {
          await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: { id: storyId },
            UpdateExpression: 'set audioStatus = :status, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
              ':status': 'error',
              ':updatedAt': new Date().toISOString(),
            },
          }));
        } catch (dbError) {
          console.error(`Failed to update DynamoDB with error status for story ${storyId}:`, dbError);
        }
      }
    }
  }
};
