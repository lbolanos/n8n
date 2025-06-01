#!/bin/bash
# deploy.sh: Build and push the n8n Docker image to ECR, then deploy serverless stack
#!/bin/bash
set -xeo pipefail #xu
CURR_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
BASE_DIR="$CURR_DIR/../../"

STAGE=${1:-dev}
AWS_REGION=${2:-us-east-1}
ECR_REPO_NAME=n8n-$STAGE
IMAGE_TAG=$STAGE
DOCKERFILE_PATH=$BASE_DIR/docker/images/n8n/Dockerfile
CONTEXT_PATH=$BASE_DIR

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$ECR_REPO_NAME:$IMAGE_TAG"

echo "Using stage: $STAGE"
echo "Using region: $AWS_REGION"

echo "Logging in to ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

if ! aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $AWS_REGION > /dev/null 2>&1; then
  echo "ECR repository $ECR_REPO_NAME does not exist. Creating..."
  aws ecr create-repository --repository-name $ECR_REPO_NAME --region $AWS_REGION
fi

# Apply the lifecycle policy to the ECR repository
LIFECYCLE_POLICY_FILE="$CURR_DIR/lifecycle-policy.json"
if [ -f "$LIFECYCLE_POLICY_FILE" ]; then
  echo "Setting lifecycle policy for $ECR_REPO_NAME from $LIFECYCLE_POLICY_FILE..."
  aws ecr put-lifecycle-policy --repository-name $ECR_REPO_NAME --lifecycle-policy-text file://$LIFECYCLE_POLICY_FILE --region $AWS_REGION
else
  echo "Warning: Lifecycle policy file $LIFECYCLE_POLICY_FILE not found. Skipping lifecycle policy update."
fi

echo "Building Docker image..."
docker build -t $ECR_REPO_NAME:$IMAGE_TAG -f $DOCKERFILE_PATH $CONTEXT_PATH

echo "Tagging image for ECR..."
docker tag $ECR_REPO_NAME:$IMAGE_TAG $ECR_URI

echo "Pushing image to ECR..."
docker push $ECR_URI

echo "Image pushed: $ECR_URI"

echo "Deploying Serverless --stage $STAGE --region $AWS_REGION"
sls deploy --stage $STAGE

