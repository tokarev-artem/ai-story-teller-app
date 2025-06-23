import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as s3_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

export class StoryTellerAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const storageBucket = new s3.Bucket(this, 'StoryTellerBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
        },
      ],
    });

    const storyTable = new dynamodb.Table(this, 'StoryTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    storyTable.addGlobalSecondaryIndex({
      indexName: 'userIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const lambdaPolicy = [
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          's3:PutObject',
          's3:GetObject',
          'dynamodb:PutItem',
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
        ],
        resources: [
          storageBucket.arnForObjects('*'),
          storageBucket.bucketArn,
          storyTable.tableArn,
          `${storyTable.tableArn}/index/*`,
          'arn:aws:bedrock:*:*:*',
        ],
      }),
      new iam.PolicyStatement({
        actions: ['polly:*'],
        resources: ['*'],
      }),
    ];

    const storyGeneratorLambda = new nodejs.NodejsFunction(this, 'StoryGeneratorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/story-generator/index.ts'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: {
        BUCKET_NAME: storageBucket.bucketName,
        TABLE_NAME: storyTable.tableName,
        BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
        REGION: this.region,
      },
    });
    lambdaPolicy.forEach(policy => storyGeneratorLambda.addToRolePolicy(policy));

    const storyEventsTopic = new sns.Topic(this, 'StoryEventsTopic', {
      displayName: 'Story Generation Events Topic',
    });

    const imageGeneratorLambda = new nodejs.NodejsFunction(this, 'ImageGeneratorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/image-generator/index.ts'),
      timeout: cdk.Duration.minutes(3),
      memorySize: 1024,
      environment: {
        BUCKET_NAME: storageBucket.bucketName,
        TABLE_NAME: storyTable.tableName,
        BEDROCK_MODEL_ID: 'amazon.titan-image-generator-v2:0',
        REGION: this.region,
      },
    });
    lambdaPolicy.forEach(policy => imageGeneratorLambda.addToRolePolicy(policy));
    imageGeneratorLambda.addEventSource(new lambda_event_sources.SnsEventSource(storyEventsTopic));

    const audioGeneratorLambda = new nodejs.NodejsFunction(this, 'AudioGeneratorFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/audio-generator/index.ts'),
      timeout: cdk.Duration.minutes(3),
      memorySize: 1024,
      environment: {
        TABLE_NAME: storyTable.tableName,
        REGION: this.region,
      },
    });
    lambdaPolicy.forEach(policy => audioGeneratorLambda.addToRolePolicy(policy));
    audioGeneratorLambda.addEventSource(new lambda_event_sources.SnsEventSource(storyEventsTopic));

    // Configure S3 bucket to send notifications directly to SNS
    storageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(storyEventsTopic)
    );

    const presignedUrlLambda = new nodejs.NodejsFunction(this, 'PresignedUrlFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/presigned-url/index.ts'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        BUCKET_NAME: storageBucket.bucketName,
        REGION: this.region,
      },
    });
    storageBucket.grantReadWrite(presignedUrlLambda);

    const storyMetadataLambda = new nodejs.NodejsFunction(this, 'StoryMetadataFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: path.join(__dirname, '../lambda/story-metadata/index.ts'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        TABLE_NAME: storyTable.tableName,
        REGION: this.region,
        PRESIGNED_URL_FUNCTION_NAME: presignedUrlLambda.functionName,
      },
    });
    storyTable.grantReadData(storyMetadataLambda);
    presignedUrlLambda.grantInvoke(storyMetadataLambda);

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      publicReadAccess: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const originAccessControl = new cloudfront.OriginAccessIdentity(this, 'OAI');

    frontendBucket.grantRead(originAccessControl);

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket, {
          originAccessIdentity: originAccessControl,
        }),
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    const backendApi = new apigatewayv2.HttpApi(this, 'BackendApiGw', {
      corsPreflight: {
        allowOrigins: [
          'https://' + distribution.distributionDomainName,
          'http://localhost:3000'
        ],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.OPTIONS
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.days(1),
      },
    });

    backendApi.addRoutes({
      path: '/story',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2integrations.HttpLambdaIntegration('StoryGeneratorIntegration', storyGeneratorLambda),
    });
    backendApi.addRoutes({
      path: '/url',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2integrations.HttpLambdaIntegration('PresignedUrlIntegration', presignedUrlLambda),
    });
    backendApi.addRoutes({
      path: '/metadata',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2integrations.HttpLambdaIntegration('StoryMetadataIntegration', storyMetadataLambda),
    });
    backendApi.addRoutes({
      path: '/metadata/{storyId}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new apigatewayv2integrations.HttpLambdaIntegration('StoryMetadataIdIntegration', storyMetadataLambda),
    });

    ['/story', '/url', '/metadata', '/metadata/{storyId}'].forEach(path => {
      backendApi.addRoutes({
        path,
        methods: [apigatewayv2.HttpMethod.OPTIONS],
        integration: new apigatewayv2integrations.HttpLambdaIntegration(
          `${path.replace(/\//g, '')}OptionsIntegration`,
          new lambda.Function(this, `${path.replace(/\//g, '')}OptionsFunction`, {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromInline(`
              exports.handler = async (event) => {
                return {
                  statusCode: 204,
                  headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
                  }
                };
              };
            `)
          })
        )
      });
    });
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../frontend/build'))],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new cdk.CfnOutput(this, 'FrontendURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront URL for the React frontend',
    });
    new cdk.CfnOutput(this, 'StorageBucketName', {
      value: storageBucket.bucketName,
      description: 'Name of the S3 bucket for storing stories',
    });
    new cdk.CfnOutput(this, 'BackendApiUrl', {
      value: backendApi.apiEndpoint,
      description: 'URL of the backend API',
    });
  }
}