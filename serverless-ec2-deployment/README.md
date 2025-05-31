# Serverless n8n Deployment with ALB, ASG, EC2, and ECR

This project provides Serverless Framework configurations to deploy a Dockerized n8n application on AWS. The architecture includes:
- An **Amazon ECR** repository to store your n8n Docker image.
- **EC2 instances** managed by an **Auto Scaling Group (ASG)**, running n8n from the Docker image.
- An **Application Load Balancer (ALB)** to distribute traffic to the n8n instances.
- All resources deployed within a custom **VPC** with public and private subnets.

## Project Structure

```
serverless-ec2-deployment/
├── resources/
│   ├── alb.yml                       # Application Load Balancer, Target Group, Listeners
│   ├── asg.yml                       # Auto Scaling Group for EC2 instances
│   ├── ec2_launch_template.yml       # EC2 Launch Template (AMI, instance type, UserData)
│   ├── ec2_security_groups.yml     # Security Groups for ALB and EC2 Instances
│   ├── ecr.yml                       # ECR Repository for Docker images
│   ├── iam_roles.yml                 # IAM Roles for EC2 instances
│   └── vpc.yml                       # VPC, subnets, IGW, NAT Gateway
├── secrets.example.yml             # Example template for secrets management
├── serverless.yml                  # Main Serverless Framework configuration
└── README.md                       # This file
```

## Prerequisites

1.  **AWS Account:** Active AWS account.
2.  **AWS CLI:** Installed and configured with necessary permissions.
    *   [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)
    *   [Configure AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html)
3.  **Node.js and npm/yarn:** For Serverless Framework.
    *   [Install Node.js](https://nodejs.org/)
4.  **Serverless Framework:** Installed globally.
    ```bash
    npm install -g serverless
    ```
5.  **Docker:** Installed locally to build and push your n8n Docker image.
    *   [Install Docker](https://docs.docker.com/get-docker/)
6.  **Your n8n Project with Dockerfile:** This setup assumes your n8n project (the one this `serverless-ec2-deployment` directory is part of, or a related one) has a Dockerfile located at `docker/images/n8n/Dockerfile` relative to your project root.

## Configuration Before First Deployment

1.  **Review `serverless.yml` (`custom:` section):**
    *   Adjust `defaultRegion` if needed.
    *   Modify parameters under `ec2LaunchTemplateParams`, `asgParams`, `ec2SecurityGroupParams` as required.
        *   **CRITICAL:** Change `ec2SecurityGroupParams.YourIPForSSH` from `0.0.0.0/0` to your specific IP address.
        *   Consider the `InstanceType` (e.g., `t3.medium` might be a good start for n8n).
        *   If you need direct SSH via key pair (SSM Session Manager is preferred), uncomment and set `KeyName` in `ec2LaunchTemplateParams`.
    *   If enabling HTTPS on the ALB, provide a `CertificateArn` under `custom.albParams` (commented out by default).

2.  **Review AMI ID in `resources/ec2_launch_template.yml` (Parameter `LatestAmiId`):**
    *   It defaults to the latest Amazon Linux 2023 AMI via an SSM parameter. This is generally recommended. If you need a different AMI, update the `Default` value for the `LatestAmiId` parameter or override it in `serverless.yml` under `custom.ec2LaunchTemplateParams`.

3.  **Secrets Management (`secrets.example.yml`):**
    *   Copy `secrets.example.yml` to `secrets.<stage>.yml` (e.g., `secrets.dev.yml`).
    *   Populate `secrets.<stage>.yml` if your n8n setup requires specific environment variables passed at runtime (e.g., for database connections if not using an integrated one, API keys for n8n itself). The UserData script in `ec2_launch_template.yml` will need to be modified to pass these to the `docker run` command.
    *   **DO NOT COMMIT `secrets.<stage>.yml` TO GIT.** Add it to your `.gitignore` file.
    *   For sensitive data, prefer injecting them into the UserData script via SSM Parameter Store references or using AWS Secrets Manager directly within the EC2 instances (requires IAM permission and runtime script adjustment).

4.  **n8n Data Persistence (UserData in `resources/ec2_launch_template.yml`):**
    *   The `docker run` command in the UserData script has a commented-out example for mounting a volume: `-v /home/ec2-user/.n8n:/home/node/.n8n`.
    *   **This is critical for n8n data persistence.** Without it, your n8n workflows and data will be lost if the container restarts or the instance is replaced.
    *   **Action Required:**
        *   Decide on your data persistence strategy:
            *   **Host Path (simple, but data lost if instance terminates):** The example path is a starting point.
            *   **EFS (recommended for multi-instance ASG or data persistence beyond instance lifecycle):** You would need to create an EFS volume and mount it in UserData. This would be an additional AWS resource to define.
            *   **Dedicated EBS Volume:** More complex to manage with ASG instance replacements.
        *   Update the `UserData` script in `resources/ec2_launch_template.yml` to implement your chosen data persistence method.

5.  **IAM Permissions (`resources/iam_roles.yml`):**
    *   Review the `EC2InstanceRole`. It includes permissions for ECR pull, SSM Session Manager, and CloudWatch Logs. Add any other permissions your n8n application/workflows might need (e.g., S3 access, specific database access if n8n connects to external DBs).

## Build and Push Your n8n Docker Image to ECR

Before you can deploy, you need to build your n8n Docker image (from `docker/images/n8n/Dockerfile`) and push it to the ECR repository that will be created by this Serverless stack.

1.  **First Deployment - Create ECR Repo:**
    *   Deploy the stack once to create the ECR repository:
        ```bash
        cd serverless-ec2-deployment
        serverless deploy --stage <your-stage> --region <your-region>
        ```
    *   After successful deployment, find the ECR repository URI. You can get this from the stack outputs in the AWS CloudFormation console or by using the AWS CLI:
        ```bash
        aws cloudformation describe-stacks --stack-name my-n8n-service-<your-stage> --query "Stacks[0].Outputs[?OutputKey=='N8nEcrRepositoryUri'].OutputValue" --output text --region <your-region>
        ```
        (Replace `my-n8n-service-<your-stage>` with your actual deployed stack name).

2.  **Log in to ECR:**
    ```bash
    aws ecr get-login-password --region <your-region> | docker login --username AWS --password-stdin <ECR_REPOSITORY_URI_FROM_STEP_1>
    ```

3.  **Build your n8n Docker image:**
    *   Navigate to the root of your n8n project (where the main `Dockerfile`'s context is, likely the parent of the `docker` directory).
    *   The image tag used in `serverless.yml` (`custom.imageTag`) is `latest` by default.
    ```bash
    # Example from the root of the n8n project if Dockerfile is at docker/images/n8n/Dockerfile
    docker build -t <ECR_REPOSITORY_URI_FROM_STEP_1>:${custom.imageTag} -f docker/images/n8n/Dockerfile .
    ```
    (Replace `${custom.imageTag}` with the actual tag, e.g., `latest`).

4.  **Push the image to ECR:**
    ```bash
    docker push <ECR_REPOSITORY_URI_FROM_STEP_1>:${custom.imageTag}
    ```

## Deployment

Once the prerequisites are met, configuration is reviewed, and your image is pushed to ECR:

1.  **Navigate to this directory:**
    ```bash
    cd serverless-ec2-deployment
    ```
2.  **Deploy the service:**
    ```bash
    serverless deploy --stage <your-stage> --region <your-region>
    ```
    *   Example: `serverless deploy --stage dev --region us-east-1`
3.  This will provision/update all resources: VPC, ECR (if first time), IAM Roles, Security Groups, Launch Template, ALB, and ASG which will launch EC2 instances.

## Accessing Your n8n Application

*   Once deployed, the ALB DNS name will be an output of the stack. Find it in the AWS CloudFormation console for the `my-n8n-service-<your-stage>` stack (Outputs tab) or use:
    ```bash
    aws cloudformation describe-stacks --stack-name my-n8n-service-<your-stage> --query "Stacks[0].Outputs[?OutputKey=='LoadBalancerDNSName'].OutputValue" --output text --region <your-region>
    ```
*   Access n8n via `http://<LoadBalancerDNSName>`. If you configured HTTPS, use `https://...`.

## Managing EC2 Instances

*   **Access via SSM Session Manager (Recommended):**
    *   The `EC2InstanceRole` is configured for SSM. Connect via AWS CLI:
        ```bash
        aws ssm start-session --target <instance-id> --region <your-region>
        ```
*   **SSH (If KeyName and SSH port are configured):**
    *   `ssh -i /path/to/your-key.pem ec2-user@<instance-ip>` (User may vary by AMI).

## Updating the Application

1.  **Build and Push a new Docker image** to ECR with a new tag or by overwriting the existing tag (e.g., `latest`), as per the "Build and Push" section.
2.  **Update the Launch Template (if needed):**
    *   If you changed the image tag in `serverless.yml` (`custom.imageTag`) or need to change UserData, instance type, etc., modify `serverless.yml` or `resources/ec2_launch_template.yml`.
    *   Deploy the changes: `serverless deploy --stage <your-stage> --region <your-region>`. This will create a new version of the Launch Template.
3.  **Refresh Instances in Auto Scaling Group:**
    *   After the Launch Template is updated, you need to tell the ASG to replace its instances with new ones based on the updated template.
    *   You can do this via the AWS Console (Auto Scaling Groups -> Select your ASG -> Instance refresh tab -> Start instance refresh).
    *   Alternatively, the ASG's `UpdatePolicy` (commented out in `asg.yml`) can be configured for rolling updates. If you enable and configure this, `serverless deploy` might trigger it, or you might use AWS CLI commands.

## Removing the Stack

To remove all deployed resources:
```bash
serverless remove --stage <your-stage> --region <your-region>
```
**Warning:** This deletes all resources, including ECR images (if the repository is deleted and not retained), EC2 instances, ALB, etc. Ensure n8n data is backed up if persistence was on host paths or ephemeral storage.

## Security Best Practices Summary

*   **Least Privilege (IAM):** Customize IAM roles.
*   **Secrets Management:** Use AWS Secrets Manager or Parameter Store for sensitive data injected into containers.
*   **ECR Image Scanning:** Enable image scanning in ECR.
*   **Network Security:** Restrict SSH. ALB for ingress. Private subnets for instances.
*   **Data Persistence:** Implement robust data persistence for n8n (e.g., EFS).
*   **HTTPS:** Configure HTTPS on the ALB with an ACM certificate for production.
*   **Logging & Monitoring:** Utilize CloudWatch.
*   **Regular Updates:** Keep AMIs, Docker images (base images), and n8n updated.
