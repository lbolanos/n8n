// rds-init-lambda.js
const { Client } = require('pg');
const AWS = require('aws-sdk');

const secretsManager = new AWS.SecretsManager();

async function getSecret(secretArn) {
  console.log(`Attempting to retrieve secret: ${secretArn}`);
  try {
    const data = await secretsManager.getSecretValue({ SecretId: secretArn }).promise();
    if ('SecretString' in data) {
      const secretJson = JSON.parse(data.SecretString);
      if (secretJson.password) {
        return secretJson.password;
      }
      throw new Error("'password' key not found in secret JSON");
    }
    throw new Error("SecretString not found in secret");
  } catch (err) {
    console.error(`Error retrieving or parsing secret ${secretArn}:`, err);
    throw err;
  }
}

exports.handler = async (event, context) => {
  console.log("RDS Init Event:", JSON.stringify(event, null, 2));

  const requestType = event.RequestType;
  let physicalResourceId = event.PhysicalResourceId || context.logStreamName;
  const responseData = {};

  if (requestType === 'Delete') {
    console.log("RequestType is Delete. No action taken for pgvector extension.");
    // It's important to send a SUCCESS response for Delete events for CFN to proceed.
    await sendCloudFormationResponse(event, context, "SUCCESS", responseData, physicalResourceId);
    return;
  }

  console.log(`RequestType is ${requestType}. Proceeding with pgvector extension check/creation.`);

  let dbClient;
  try {
    const dbHost = process.env.DB_HOST;
    const dbPort = parseInt(process.env.DB_PORT, 10);
    const dbUser = process.env.DB_USER;
    const dbName = process.env.DB_NAME;
    const dbPasswordSecretArn = process.env.DB_PASSWORD_SECRET_ARN;

    if (!dbHost || !dbPort || !dbUser || !dbName || !dbPasswordSecretArn) {
      const errMsg = "Missing required environment variables: DB_HOST, DB_PORT, DB_USER, DB_NAME, DB_PASSWORD_SECRET_ARN.";
      console.error(errMsg);
      throw new Error(errMsg);
    }

    const dbPassword = await getSecret(dbPasswordSecretArn);

    dbClient = new Client({
      host: dbHost,
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      ssl: {
        rejectUnauthorized: true,
        ca: AWS.RDS.CACerts.RDSCa2019
      },
      connectionTimeoutMillis: 20000,
    });

    console.log(`Attempting to connect to database '${dbName}' at ${dbHost}:${dbPort} as user '${dbUser}'`);
    await dbClient.connect();
    console.log("Successfully connected to the database.");

    console.log("Executing: CREATE EXTENSION IF NOT EXISTS pgvector;");
    await dbClient.query('CREATE EXTENSION IF NOT EXISTS pgvector;');
    console.log("Successfully executed CREATE EXTENSION IF NOT EXISTS pgvector;");
    responseData.Status = "pgvector extension ensured successfully.";
    
    if (requestType === 'Create') {
        physicalResourceId = `rds-pgvector-init-${dbName}-${event.LogicalResourceId}`;
    }

    await sendCloudFormationResponse(event, context, "SUCCESS", responseData, physicalResourceId);
  } catch (error) {
    console.error("Error during RDS initialization for pgvector:", error.message, error.stack);
    responseData.Error = error.toString();
    await sendCloudFormationResponse(event, context, "FAILED", responseData, physicalResourceId);
  } finally {
    if (dbClient) {
      await dbClient.end();
      console.log("Database client disconnected.");
    }
  }
};

async function sendCloudFormationResponse(event, context, responseStatus, responseData, physicalResourceId) {
  const https = require('https');
  const url = require('url');

  const responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
    PhysicalResourceId: physicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: responseData,
  });

  console.log("CloudFormation Response Body:\n", responseBody);

  const parsedUrl = url.parse(event.ResponseURL);
  const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: "PUT",
    headers: {
      "content-type": "",
      "content-length": responseBody.length,
    },
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      console.log(`CloudFormation Response Status: ${response.statusCode}`);
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode >= 400) {
          console.error(`CloudFormation PUT request failed with status ${response.statusCode}: ${body}`);
          // Resolve even on error to allow CloudFormation to handle the FAILED status from the responseBody
        }
        resolve(); 
      });
    });
    request.on("error", (error) => {
      console.error("sendCloudFormationResponse Error:", error);
      reject(error);
    });
    request.write(responseBody);
    request.end();
  });
}
