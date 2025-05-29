# n8n on AWS Fargate: Deployment Guide

This guide provides step-by-step instructions for deploying n8n to AWS Fargate using the `n8n-fargate-service.yaml` CloudFormation template. This setup leverages AWS Fargate for serverless container orchestration, an Application Load Balancer (ALB) for request distribution and SSL termination, and AWS RDS (PostgreSQL recommended) for the database backend.

Refer to the `GUIDANCE_RDS_SECRETS.md` file for detailed information on setting up your RDS instance and managing secrets with AWS Secrets Manager.

## 0. Prerequisites

Before you begin, ensure you have the following:

*   **AWS Account:** An active AWS account with appropriate permissions to create the resources defined in the CloudFormation template (IAM roles, ECS services, Load Balancers, Security Groups, etc.).
*   **AWS CLI (Optional but Recommended):** Configured for your AWS account if you prefer deploying via the command line.
*   **Existing VPC Details:**
    *   VPC ID (`VpcId`)
    *   At least two Private Subnet IDs (`PrivateSubnetIds`) in different Availability Zones for the Fargate tasks. These subnets should have a route to a NAT Gateway or NAT Instance for outbound internet access (e.g., to pull the n8n Docker image).
    *   At least two Public Subnet IDs (`PublicSubnetIds`) in different Availability Zones for the Application Load Balancer. These subnets should have a route to an Internet Gateway.
*   **RDS Instance Details:**
    *   An existing or planned RDS PostgreSQL instance. Refer to `GUIDANCE_RDS_SECRETS.md` for setup recommendations.
    *   RDS Hostname (`DBHost`)
    *   RDS Database Name (`DBName`, e.g., "n8n")
    *   RDS User (`DBUser`, e.g., "n8nuser")
    *   RDS Security Group ID (`RDSSecurityGroupId`): Ensure this security group allows inbound traffic from the Fargate service on the database port (default 5432).
*   **SSL Certificate ARN:**
    *   An ACM (AWS Certificate Manager) SSL certificate ARN (`SSLCertificateArn`) for your desired n8n hostname (e.g., `n8n.yourdomain.com`). The certificate must be in the same region where you deploy the CloudFormation stack.
*   **AWS Secrets Manager ARNs:**
    *   **Database Password:** ARN of the secret storing your RDS database password (`DBPasswordSecretArn`). See `GUIDANCE_RDS_SECRETS.md`.
    *   **n8n Encryption Key (Optional, Recommended):** ARN of the secret for `N8N_ENCRYPTION_KEY` (`EncryptionKeySecretArn`). See `GUIDANCE_RDS_SECRETS.md`.
    *   **SMTP Password (Optional):** ARN of the secret for your SMTP password (`SmtpPasswordSecretArn`) if using SMTP for email notifications. See `GUIDANCE_RDS_SECRETS.md`.
*   **CloudFormation Template:**
    *   The `n8n-fargate-service.yaml` file.

## 1. Review Configuration & Guidance

*   Carefully review all parameters in the `n8n-fargate-service.yaml` template to understand their purpose and default values.
*   Thoroughly read the `GUIDANCE_RDS_SECRETS.md` document to understand RDS setup best practices and how to create and manage the necessary secrets in AWS Secrets Manager.

## 2. Prepare RDS & Secrets

*   Ensure your RDS PostgreSQL instance is (or will be) configured according to the recommendations in `GUIDANCE_RDS_SECRETS.md`.
*   Create all required secrets (DB password, and optionally N8N_ENCRYPTION_KEY, SMTP password) in AWS Secrets Manager.
*   Note down the ARNs for each secret. You will need these for the CloudFormation stack parameters.

## 3. Deploy CloudFormation Stack

You can deploy the CloudFormation stack using either the AWS Management Console or the AWS CLI.

### Using AWS Management Console:

1.  **Navigate to CloudFormation:** Open the AWS Management Console, select your desired region, and go to the CloudFormation service.
2.  **Create Stack:** Click on "**Create stack**" and choose "**With new resources (standard)**".
3.  **Prepare template:** Select "**Template is ready**".
4.  **Specify template:** Choose "**Upload a template file**", click "**Choose file**", and select your `n8n-fargate-service.yaml` file. Click "**Next**".
5.  **Specify stack details:**
    *   **Stack name:** Enter a descriptive name for your stack (e.g., `n8n-production-stack` or `my-n8n-app`).
    *   **Parameters:** Carefully fill in all the parameters. Pay close attention to:
        *   `VpcId`
        *   `PrivateSubnetIds` (comma-separated list)
        *   `PublicSubnetIds` (comma-separated list)
        *   `N8NHostName` (e.g., `n8n.yourdomain.com`)
        *   `SSLCertificateArn`
        *   `DBHost`
        *   `DBPasswordSecretArn`
        *   `RDSSecurityGroupId`
        *   `EncryptionKeySecretArn` (optional, but highly recommended)
        *   Other parameters like `DBName`, `DBUser`, `Timezone`, `SmtpHost`, `SmtpUser`, `SmtpPasswordSecretArn`, `SmtpSender`, `TaskCpu`, `TaskMemory`, `DesiredTasks` as per your requirements.
6.  Click "**Next**".
7.  **Configure stack options:** You can leave most options as default or configure tags, stack policies, and notification options as needed. Click "**Next**".
8.  **Review:** Review all the details.
    *   **Crucially, at the bottom of the page, acknowledge that AWS CloudFormation might create IAM resources with custom names by checking the boxes:**
        *   "I acknowledge that AWS CloudFormation might create IAM resources."
        *   "I acknowledge that AWS CloudFormation might create IAM resources with custom names." (This one might appear depending on the exact resources).
        *   "I acknowledge that AWS CloudFormation might require the following capability: CAPABILITY_AUTO_EXPAND" (if applicable)
9.  Click "**Create stack**".

### Using AWS CLI:

1.  Ensure your AWS CLI is configured with the correct credentials and region.
2.  Use the `aws cloudformation deploy` command. You can provide parameters directly or using a JSON parameter file.

    ```bash
    aws cloudformation deploy \
      --template-file n8n-fargate-service.yaml \
      --stack-name n8n-production-stack \
      --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
      --parameter-overrides \
        VpcId="vpc-YOUR_VPC_ID" \
        PrivateSubnetIds="subnet-YOUR_PRIVATE_SUBNET_A_ID,subnet-YOUR_PRIVATE_SUBNET_B_ID" \
        PublicSubnetIds="subnet-YOUR_PUBLIC_SUBNET_A_ID,subnet-YOUR_PUBLIC_SUBNET_B_ID" \
        N8NHostName="n8n.yourdomain.com" \
        SSLCertificateArn="arn:aws:acm:YOUR_REGION:YOUR_ACCOUNT_ID:certificate/YOUR_CERT_ID" \
        DBHost="your-rds-instance.xxxxxxxxxx.your-region.rds.amazonaws.com" \
        DBName="n8n_database" \
        DBUser="n8n_user" \
        DBPasswordSecretArn="arn:aws:secretsmanager:YOUR_REGION:YOUR_ACCOUNT_ID:secret:YOUR_DB_SECRET_NAME-XXXXXX" \
        RDSSecurityGroupId="sg-YOUR_RDS_SG_ID" \
        DesiredTasks="2" \
        TaskCpu="1024" \
        TaskMemory="2048" \
        Timezone="America/New_York" \
        # Optional - uncomment and provide values if used:
        # EncryptionKeySecretArn="arn:aws:secretsmanager:YOUR_REGION:YOUR_ACCOUNT_ID:secret:YOUR_ENCRYPTION_KEY_SECRET_NAME-XXXXXX" \
        # SmtpHost="email-smtp.your-region.amazonaws.com" \
        # SmtpPort="587" \
        # SmtpUser="YOUR_SMTP_USER" \
        # SmtpPasswordSecretArn="arn:aws:secretsmanager:YOUR_REGION:YOUR_ACCOUNT_ID:secret:YOUR_SMTP_PASS_SECRET_NAME-XXXXXX" \
        # SmtpSender="noreply@yourdomain.com" \
        # TaskRoleArn="arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_OPTIONAL_TASK_ROLE"
    ```
    **Note:** Replace all `YOUR_*` placeholders with your actual values. `PrivateSubnetIds` and `PublicSubnetIds` should be comma-delimited lists of subnet IDs.

## 4. Post-Deployment Steps

1.  **Wait for Stack Completion:** The CloudFormation stack creation can take 10-20 minutes. Monitor its status in the CloudFormation console. It will show `CREATE_COMPLETE` when done.
2.  **Retrieve ALB DNS Name:**
    *   In the CloudFormation console, select your stack.
    *   Go to the "**Outputs**" tab.
    *   Copy the value for `ALBDNSName`.
3.  **Configure DNS:**
    *   Go to your DNS provider (e.g., Amazon Route 53, GoDaddy, Cloudflare).
    *   Create a CNAME record for your chosen `N8NHostName` (e.g., `n8n.yourdomain.com`) pointing to the `ALBDNSName` you copied.
    *   DNS propagation might take some time.
4.  **Access n8n & Setup Owner Account:**
    *   Once DNS has propagated, open your web browser and navigate to `https://<Your-N8NHostName>` (e.g., `https://n8n.yourdomain.com`).
    *   You should see the n8n setup page. Follow the instructions to create your n8n owner account.

## 5. Basic Troubleshooting

If you encounter issues:

*   **Check CloudFormation Stack Events:** In the CloudFormation console, select your stack and go to the "**Events**" tab. This log shows the sequence of resource creation and any errors encountered.
*   **Check ECS Service Events:**
    *   Navigate to the ECS (Elastic Container Service) console.
    *   Select your cluster (e.g., `n8n-cluster`).
    *   Go to the "**Services**" tab and select your service (e.g., `n8n-service`).
    *   Check the "**Events**" tab for messages related to task deployments, health checks, etc.
*   **Check Fargate Task Logs in CloudWatch Logs:**
    *   The n8n application logs are sent to CloudWatch Logs.
    *   Navigate to the CloudWatch console and go to "**Log groups**".
    *   Find the log group named `/ecs/n8n-app` (or as configured by the `LogGroup` resource in the template if you changed its name).
    *   Look for log streams prefixed with `ecs`. These contain the stdout/stderr from your n8n containers. Check for any error messages.

## 6. Updating the Stack

To update your n8n deployment (e.g., change n8n version, modify task CPU/memory, or other parameters):

1.  Modify your local copy of the `n8n-fargate-service.yaml` template if needed, or prepare new parameter values.
2.  In the CloudFormation console, select your stack.
3.  Click "**Update**".
4.  Choose "**Replace current template**" (if you modified the YAML) or "**Use current template**" (if you are only changing parameters).
5.  Upload the new template or modify parameters as needed.
6.  Review the changes and acknowledge any IAM changes.
7.  Click "**Update stack**".

CloudFormation will perform a rolling update of your Fargate service if possible.

## 7. Cleaning Up

To remove the n8n deployment:

1.  **Delete the CloudFormation Stack:**
    *   In the CloudFormation console, select your stack.
    *   Click "**Delete**".
    *   Confirm the deletion. This will remove all resources created by the stack.
2.  **Manually Delete Resources (if necessary):**
    *   **RDS Instance:** The CloudFormation template does *not* delete your RDS instance. If you created it specifically for this n8n deployment and no longer need it, you must delete it manually from the RDS console.
    *   **CloudWatch Log Groups:** By default, the log group `/ecs/n8n-app` will be retained (as per default CloudFormation behavior for LogGroups unless `RetentionInDays` is explicitly set to 0 or the parameter is removed, and the stack is deleted). You can manually delete it from the CloudWatch console if you no longer need the logs.
    *   **Secrets Manager Secrets:** Secrets stored in AWS Secrets Manager are not deleted by the CloudFormation stack. Delete them manually if they are no longer needed.
    *   **ECR Images:** If you pushed custom n8n images to ECR, these are not managed by the stack.

This guide should help you deploy and manage your n8n instance on AWS Fargate. Remember to consult the official AWS documentation for any specific service configurations.
