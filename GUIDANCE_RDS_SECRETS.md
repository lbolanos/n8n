# Guidance: AWS RDS and Secrets Manager for n8n Deployment

This document provides guidance on setting up AWS RDS (PostgreSQL) for your n8n deployment and managing sensitive information using AWS Secrets Manager. These practices are recommended for a secure and robust n8n installation using the provided CloudFormation template (`n8n-fargate-service.yaml`).

## 1. Recommended AWS RDS (PostgreSQL) Setup for n8n

While n8n supports various databases, **PostgreSQL is highly recommended for production deployments** due to its robustness and scalability.

### Key RDS Configuration Points:

When setting up your PostgreSQL RDS instance, consider the following:

*   **Instance Size:**
    *   Start with a general-purpose instance like `db.t3.medium` or `db.t4g.medium` (for ARM-based instances, if preferred).
    *   Monitor your n8n usage and database load to adjust the instance size as needed.
*   **Storage:**
    *   Use **SSD (gp2, gp3, or io1)** for good performance.
    *   Start with a reasonable initial size (e.g., 20-50 GB).
    *   **Enable storage auto-scaling** to allow the database to grow without manual intervention.
*   **Multi-AZ Deployment:**
    *   **Strongly recommended for High Availability (HA).** This creates a standby replica in a different Availability Zone, which AWS fails over to in case of an issue with the primary instance.
*   **Automated Backups:**
    *   Enable automated backups and configure a suitable retention period (e.g., 7-30 days) to allow for point-in-time recovery.
*   **VPC & Subnets:**
    *   Deploy the RDS instance in the **same VPC** as your n8n Fargate service.
    *   Place the RDS instance in **private subnets** for enhanced security. These subnets should not have a direct route to the internet.
*   **Security Group Configuration:**
    *   You will create a dedicated Security Group for your RDS instance.
    *   The **ID of this RDS Security Group** needs to be provided as the `RDSSecurityGroupId` parameter when launching the `n8n-fargate-service.yaml` CloudFormation stack.
    *   This RDS Security Group **must allow inbound TCP traffic on the PostgreSQL port (default 5432) from the `FargateServiceSecurityGroup`**. The `FargateServiceSecurityGroup` is created automatically by the CloudFormation template.
    *   **Conceptual Example:**
        *   If your Fargate Service Security Group has an ID of `sg-fargate123`, your RDS Security Group should have an inbound rule like: Type: `PostgreSQL` (or `Custom TCP`), Protocol: `TCP`, Port Range: `5432`, Source: `sg-fargate123`.
*   **Database Name and User:**
    *   Choose a database name (e.g., `n8n` or `n8n_prod`). This will be used for the `DBName` CloudFormation parameter (default is `n8n`).
    *   Create a dedicated database user (e.g., `n8nuser`). This will be used for the `DBUser` CloudFormation parameter (default is `n8nuser`).
    *   The password for this user will be stored in AWS Secrets Manager (see section below).
*   **Encryption at Rest:**
    *   **Enable encryption at rest** for your RDS instance using AWS KMS (default AWS-managed key or a customer-managed key). This protects the underlying storage.
*   **Maintenance Window:**
    *   Configure a suitable weekly maintenance window for RDS updates and patches.

## 2. Using AWS Secrets Manager

AWS Secrets Manager helps you protect secrets needed to access your applications, services, and IT resources. Instead of hardcoding sensitive information, you can store it in Secrets Manager and have your application retrieve it programmatically.

### For RDS Database Password:

*   **Benefits:**
    *   Avoids hardcoding database passwords in the CloudFormation template or environment variables directly.
    *   Enables automatic password rotation (though this requires additional setup beyond the scope of this guide).
    *   Centralized management and auditing of secrets.
*   **Steps to create a secret:**
    1.  Navigate to the **AWS Secrets Manager** console.
    2.  Click on "**Store a new secret**".
    3.  **Secret type:**
        *   Select "**Credentials for RDS database**" if your RDS instance already exists and you want to link it directly. This will pre-populate some fields.
        *   Alternatively, select "**Other type of secret**" for more flexibility (e.g., if RDS is created later or managed separately).
            *   If using "Other type of secret", create a single key-value pair. For example:
                *   **Key:** `password`
                *   **Value:** *YourStrongDatabasePassword*
    4.  Enter the strong, unique password for the `DBUser` you configured during RDS setup.
    5.  **Encryption key:** The default AWS-managed key `aws/secretsmanager` is usually sufficient.
    6.  **Secret name:** Give your secret a descriptive name (e.g., `n8n/prod/db_password` or `n8n-rds-password`).
    7.  Review and click "**Store**".
    8.  **CRITICAL:** After the secret is created, select it from the list. On its details page, **copy the "Secret ARN"**. This ARN is required for the `DBPasswordSecretArn` CloudFormation parameter.

### For `N8N_ENCRYPTION_KEY` (Optional but Highly Recommended):

*   **Importance:** The `N8N_ENCRYPTION_KEY` is used by n8n to encrypt sensitive credential data that it stores in the database (e.g., API keys, tokens used in your workflows). If not set, n8n uses a default key which is less secure. Setting your own unique key significantly enhances security.
*   **How to create a secret:**
    1.  In AWS Secrets Manager, click "**Store a new secret**".
    2.  Select "**Other type of secret**".
    3.  Create a single key-value pair:
        *   **Key:** `N8N_ENCRYPTION_KEY`
        *   **Value:** *GenerateALongRandomStrongString* (e.g., use a password manager to generate a 32 or 64-character random string). This value should be kept very secure and backed up.
    4.  Choose an encryption key (default `aws/secretsmanager` is fine).
    5.  Provide a secret name (e.g., `n8n/prod/encryption_key` or `n8n-encryption-key`).
    6.  Review and store the secret.
    7.  **Copy the "Secret ARN"** to be used for the `EncryptionKeySecretArn` CloudFormation parameter. If you do not want to use this feature, leave the `EncryptionKeySecretArn` parameter blank when deploying the CloudFormation stack.

### For SMTP Password (Optional):

*   If you plan to configure n8n to send emails via SMTP and your SMTP server requires authentication, you should store the SMTP password securely.
*   **How to create a secret:**
    1.  In AWS Secrets Manager, click "**Store a new secret**".
    2.  Select "**Other type of secret**".
    3.  Create a single key-value pair:
        *   **Key:** `password` (or `smtp_password`)
        *   **Value:** *YourSmtpPassword*
    4.  Choose an encryption key.
    5.  Provide a secret name (e.g., `n8n/prod/smtp_password` or `n8n-smtp-password`).
    6.  Review and store the secret.
    7.  **Copy the "Secret ARN"** to be used for the `SmtpPasswordSecretArn` CloudFormation parameter. If SMTP does not require a password or you are not configuring SMTP, leave this parameter blank.

### Permissions Reminder:

*   The Fargate `ExecutionRole` (using `AmazonECSTaskExecutionRolePolicy`) created by the `n8n-fargate-service.yaml` CloudFormation template generally has permissions to fetch these secrets from AWS Secrets Manager.
*   **Important Note:** If you encrypt your secrets with a Customer-Managed Key (CMK) in KMS, ensure the `n8nExecutionRole` (or the ARN specified in the `ExecutionRoleArn` parameter if you customized the role) has `kms:Decrypt` permissions for that specific CMK.

By following this guidance, you can establish a secure and well-configured backend for your n8n application on AWS.
