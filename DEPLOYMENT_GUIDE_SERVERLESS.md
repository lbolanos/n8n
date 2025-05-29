# n8n on AWS Fargate with Serverless Framework: Deployment Guide

## 1. Overview

This guide provides step-by-step instructions for deploying a scalable n8n application on AWS Fargate. The entire infrastructure, including a new VPC, an RDS PostgreSQL database instance (with the `pgvector` extension automatically enabled), and the n8n Fargate service itself, is managed by the Serverless Framework using the provided `serverless.yml` configuration.

This setup is designed for production use, offering high availability, scalability, and secure secret management.

## 2. Prerequisites

Before you begin, ensure you have the following:

*   **Node.js and npm (or yarn/pnpm):** Required for installing dependencies and running the Serverless Framework. Node.js version 18.x or higher is recommended.
*   **Serverless Framework:** Installed globally. If not, install it using npm:
    ```bash
    npm install -g serverless
    ```
*   **AWS CLI:** Configured with valid AWS credentials and a default AWS region. The Serverless Framework uses the AWS CLI's configuration for deployment. Ensure your IAM user/role has permissions to create all resources defined in `serverless.yml` (VPC, Subnets, RDS, ECS, Fargate, IAM Roles, Secrets, Load Balancers, etc.).
*   **AWS ACM SSL Certificate ARN:** An existing SSL certificate managed by AWS Certificate Manager (ACM) is required for HTTPS access to your n8n instance. This certificate must be in the **same AWS region** where you plan to deploy n8n.

## 3. Project Files

You will need the following files in your project directory:

*   **`serverless.yml`**: The main Serverless Framework configuration file defining all AWS resources.
*   **`rds-init-lambda.js`**: A Node.js Lambda function script responsible for connecting to the newly created RDS instance and enabling the `pgvector` extension.
*   **`package.json`**: Defines the dependencies for the `rds-init-lambda.js` function, specifically the `pg` (PostgreSQL client) library. It should look something like this:
    ```json
    {
      "name": "n8n-serverless-app-lambda-deps",
      "version": "1.0.0",
      "description": "Dependencies for n8n Serverless Lambdas",
      "dependencies": {
        "pg": "^8.11.3"
      }
    }
    ```

## 4. Configuration / Key Parameters

The `serverless.yml` file contains the complete infrastructure-as-code definition for this deployment. Many aspects are parameterized to allow customization.

### Critical Parameters (Required at Deployment):

These parameters **must** be provided when running `serverless deploy`:

*   `acmCertificateArn`: (String) The ARN of your existing ACM SSL certificate.
    *   Example: `arn:aws:acm:us-east-1:123456789012:certificate/your-certificate-id`
*   `n8nHostName`: (String) The custom domain name (e.g., `n8n.yourdomain.com`) that will be used to access your n8n instance. You will later point your DNS to the created Application Load Balancer.

### Important Optional Parameters:

These parameters have defaults set in `serverless.yml` or can be influenced by your AWS CLI/Serverless Framework setup, but you might want to override them:

*   `awsRegion`: (String, e.g., `us-east-1`) The AWS region for deployment. Can be set in `serverless.yml` (`provider.region`) or via the `--region` CLI flag.
*   `awsStage`: (String, e.g., `dev`, `prod`) The deployment stage. Set in `serverless.yml` (`provider.stage`) or via the `--stage` CLI flag.
*   Task sizing:
    *   `taskCpu`: (String, e.g., `"1024"`) CPU units for the n8n Fargate task.
    *   `taskMemory`: (String, e.g., `"2048"`) Memory (in MiB) for the n8n Fargate task.
*   Scaling:
    *   `desiredTasks`: (Number, e.g., `2`) Initial number of n8n tasks to run.
    *   `minTasks`, `maxTasks`: (Numbers, e.g., `2`, `4`) Minimum and maximum number of tasks for auto-scaling.
*   RDS:
    *   `dbInstanceClass`: (String, e.g., `db.t3.medium`) The instance class for the RDS PostgreSQL database.
    *   `dbUserForN8NTask`: (String, default: `n8nadmin`) Username n8n will use to connect to its database. Must match the RDS `MasterUsername`.
    *   `dbNameForN8NTask`: (String, default: `n8nDatabase`) The logical database name n8n will use. Must match the RDS `DBName`.
*   n8n settings:
    *   `n8nImageUrl`: (String, e.g., `docker.n8n.io/n8nio/n8n:latest`) The n8n Docker image to use.
    *   `timezone`: (String, e.g., `America/New_York`) The timezone for n8n.
    *   `executionsMode`: (String, e.g., `queue`) n8n execution mode.
    *   SMTP Variables:
        *   `emailMode`: (String, e.g., `smtp`) n8n email mode.
        *   `smtpHost`, `smtpPort`, `smtpUser`, `smtpSender`: Configuration for your SMTP provider.
        *   `smtpPasswordSecretArnForTask`: ARN of the AWS Secrets Manager secret storing your SMTP password. If provided, the `N8NSmtpPasswordSecret` resource defined in `serverless.yml` can be used, or you can use a pre-existing secret.
*   `taskRoleArn`: (String) Optional ARN of a custom IAM role for n8n Fargate tasks if they need specific permissions to interact with other AWS services beyond what the `FargateTaskExecutionRole` provides for pulling images and secrets.
*   `logRetentionInDays`: (Number, e.g., `7`) CloudWatch Log Group retention period.
*   `healthCheckGracePeriodSeconds`: (Number, e.g., `60`) Time for ECS to ignore unhealthy task health checks after a task has first started.

**Parameter Management:**

You can provide these parameters directly via the `--param` flag during deployment (e.g., `--param="n8nHostName=n8n.example.com"`). For easier management of multiple parameters, especially for different stages, consider:

*   Defining them in the `custom.parameters` section of your `serverless.yml` (see commented examples in the file).
*   Using a separate configuration file per stage (e.g., `config.dev.yml`, `config.prod.yml`) and referencing it with `serverless deploy --config config.dev.yml --param="..."`.

## 5. Deployment Steps

1.  **Clone/Download Project Files:**
    Ensure you have `serverless.yml`, `rds-init-lambda.js`, and `package.json` (for Lambda dependencies) in your project directory.

2.  **Install Lambda Dependencies:**
    Navigate to the root of your project directory (where `package.json` is located) in your terminal and run:
    ```bash
    npm install
    ```
    (Or `yarn install` / `pnpm install` if you use those package managers). This installs the `pg` library needed by the `rds-init-lambda.js` function.

3.  **Deploy using Serverless Framework:**
    Execute the deployment command. You **must** provide `acmCertificateArn` and `n8nHostName`.
    ```bash
    serverless deploy \
      --param="acmCertificateArn=YOUR_ACM_CERTIFICATE_ARN" \
      --param="n8nHostName=n8n.yourdomain.com" \
      --stage yourStage \
      --region yourRegion
    ```
    **Replace placeholders:**
    *   `YOUR_ACM_CERTIFICATE_ARN`: The actual ARN of your SSL certificate.
    *   `n8n.yourdomain.com`: Your desired hostname for n8n.
    *   `yourStage`: Your deployment stage (e.g., `dev`, `prod`).
    *   `yourRegion`: The AWS region (e.g., `us-east-1`).

    You can add other `--param` overrides as needed for optional parameters. For example:
    ```bash
    serverless deploy \
      --param="acmCertificateArn=arn:aws:acm:us-east-1:123456789012:certificate/xxxxxxxx" \
      --param="n8nHostName=n8n.example.com" \
      --param="taskMemory=4096" \
      --param="desiredTasks=3" \
      --stage prod --region us-west-2
    ```
    The first deployment will take a significant amount of time (20-40 minutes or more) as it provisions a new VPC, RDS instance, ECS cluster, ALB, and other resources. Subsequent updates are usually faster.

## 6. Post-Deployment Setup

1.  **Wait for Completion:**
    Monitor the deployment progress in your terminal. The Serverless Framework will output updates and indicate when the stack creation is complete. You can also monitor the stack in the AWS CloudFormation console.

2.  **Retrieve Outputs:**
    Once deployment is complete, retrieve the stack outputs, particularly the `ALBDNSName`:
    ```bash
    serverless info --verbose --stage yourStage --region yourRegion
    ```
    Look for `ALBDNSName` in the "Outputs" section.

3.  **Configure DNS:**
    *   Go to your DNS provider (e.g., Amazon Route 53, Cloudflare, GoDaddy).
    *   Create a CNAME record for the `n8nHostName` you specified during deployment (e.g., `n8n.yourdomain.com`).
    *   Point this CNAME record to the `ALBDNSName` value obtained in the previous step.
    *   DNS propagation might take some time (minutes to hours, depending on your DNS provider and TTL settings).

4.  **Access n8n:**
    Once DNS has propagated, open your web browser and navigate to `https://<your_n8nHostName>` (e.g., `https://n8n.yourdomain.com`).

5.  **Initial n8n Setup:**
    You should see the n8n setup page. Follow the on-screen instructions to create your n8n owner account.

6.  **Secure `N8NEncryptionKeySecret` Value:**
    The `serverless.yml` creates an AWS Secrets Manager secret named `${self:service}/${self:provider.stage}/n8n-encryption-key` (e.g., `n8n-serverless-app/dev/n8n-encryption-key`) which contains an auto-generated encryption key.
    *   **Retrieve this key's value** from AWS Secrets Manager.
    *   **Store it securely** in your password manager or other secure location. This key is critical for n8n's internal data encryption. If you ever need to restore your n8n setup or migrate the database, you will need this exact key to decrypt existing credential data.
    *   Alternatively, you could have updated this secret with your own pre-generated strong key immediately after the secret resource was created by Serverless (and before n8n started using it) if you preferred not to use the auto-generated one.

## 7. Managing the Deployment

*   **Updating:**
    To update your n8n deployment (e.g., change n8n version via `n8nImageUrl` parameter, modify task CPU/memory, or other parameters in `serverless.yml`), make your changes and then re-run the `serverless deploy` command with the relevant parameters.
    ```bash
    serverless deploy --param="acmCertificateArn=YOUR_ACM_CERTIFICATE_ARN" --param="n8nHostName=n8n.yourdomain.com" --stage yourStage --region yourRegion
    ```
*   **View Logs:**
    *   **n8n Application Logs:** Access these through AWS CloudWatch Logs. The log group is typically named `/ecs/n8n-serverless-app-yourStage/n8n-app`. (Replace `yourStage` with your actual stage name).
    *   **pgvector Init Lambda Logs:** Use the Serverless Framework CLI:
        ```bash
        serverless logs -f RDSInitLambdaFunction --stage yourStage --region yourRegion
        ```
*   **Get Information:**
    ```bash
    serverless info --verbose --stage yourStage --region yourRegion
    ```

## 8. Troubleshooting Tips

*   **Verbose Deployment Output:** For more detailed output during deployment, add the `--verbose` flag:
    ```bash
    serverless deploy --verbose --param="..." --stage yourStage --region yourRegion
    ```
*   **CloudFormation Events:** Check the AWS CloudFormation console. Select your stack (e.g., `n8n-serverless-app-yourStage`) and look at the "Events" tab for detailed resource creation status and errors.
*   **CloudWatch Logs:** Inspect logs for Fargate tasks (in `/ecs/n8n-serverless-app-yourStage/n8n-app`) and the `RDSInitLambdaFunction` for any runtime errors.

## 9. Cleanup / Removal

To remove all resources created by this Serverless Framework stack:

1.  **Run `serverless remove`:**
    ```bash
    serverless remove --stage yourStage --region yourRegion
    ```
    Replace `yourStage` and `yourRegion` with your deployment's stage and region.

2.  **Manual Deletion (if necessary):**
    The `serverless remove` command attempts to delete all CloudFormation-managed resources. However, some resources might require manual deletion based on their DeletionPolicy or if they are not fully managed by the stack:
    *   **S3 Deployment Bucket:** Serverless Framework creates an S3 bucket for deployment artifacts. While `serverless remove` often empties and deletes it, you might need to manually empty and delete it from the S3 console if it persists.
    *   **RDS Snapshots:** The RDS instance is configured with `DeletionPolicy: Snapshot`. This means that when the stack is deleted, a final snapshot of the database will be taken. These snapshots are retained and incur storage costs. If you do not need them, delete them manually from the RDS console under "Snapshots".
    *   **Secrets in AWS Secrets Manager:** Secrets created by this stack (`N8NDBPasswordSecret`, `N8NEncryptionKeySecret`, `N8NSmtpPasswordSecret`) are typically *not* deleted by default to prevent accidental data loss. You must manually delete them from AWS Secrets Manager if they are no longer needed. You can configure them for scheduled deletion.
    *   **CloudWatch Log Groups:** Log groups might be retained based on default AWS behavior or if their `RetentionInDays` policy was set to never expire. Manually delete them from CloudWatch if you no longer need the logs.

This guide provides a comprehensive path to deploying and managing your n8n instance on AWS Fargate using Serverless Framework. Always consult the official AWS documentation for specific service configurations and best practices.
