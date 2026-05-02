################################################################################
# IPL 2026 Auction — Root Terraform Module
# Targets: AWS (default). Override with -var="cloud_provider=gcp" for GCP.
#
# Resources provisioned:
#   VPC + subnets (3 AZ)
#   RDS Postgres 15 (Multi-AZ in prod)
#   ElastiCache Redis 7 (cluster mode disabled — single-node for MVP)
#   EKS 1.30 cluster + managed node group
#   S3 bucket (headshots) + CloudFront CDN
#   Route53 hosted zone + ACM certificate
#   IAM roles for IRSA (pod identity)
#   KMS key for secrets encryption at rest
################################################################################

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.33"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.16"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state — change bucket/key for your account
  backend "s3" {
    bucket         = "ipl-auction-tfstate"
    key            = "staging/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "ipl-auction-tfstate-lock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ipl-auction"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

################################################################################
# VPC
################################################################################

module "vpc" {
  source  = "./modules/vpc"

  name               = "${var.project_name}-${var.environment}"
  cidr               = var.vpc_cidr
  availability_zones = var.availability_zones
  environment        = var.environment
}

################################################################################
# Postgres 15
################################################################################

module "postgres" {
  source  = "./modules/postgres"

  identifier        = "${var.project_name}-${var.environment}"
  engine_version    = "15.8"
  instance_class    = var.postgres_instance_class
  db_name           = "ipl_auction"
  username          = "ipl_app"
  vpc_id            = module.vpc.vpc_id
  subnet_ids        = module.vpc.private_subnet_ids
  allowed_sg_ids    = [module.eks.node_security_group_id]
  multi_az          = var.environment == "production"
  deletion_protection = var.environment == "production"
  environment       = var.environment
}

################################################################################
# Redis 7
################################################################################

module "redis" {
  source  = "./modules/redis"

  cluster_id        = "${var.project_name}-${var.environment}"
  engine_version    = "7.1"
  node_type         = var.redis_node_type
  vpc_id            = module.vpc.vpc_id
  subnet_ids        = module.vpc.private_subnet_ids
  allowed_sg_ids    = [module.eks.node_security_group_id]
  at_rest_encryption = true
  transit_encryption = true
  environment       = var.environment
}

################################################################################
# EKS 1.30
################################################################################

module "eks" {
  source  = "./modules/eks"

  cluster_name    = "${var.project_name}-${var.environment}"
  cluster_version = "1.30"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnet_ids
  node_groups     = var.eks_node_groups
  environment     = var.environment
}

################################################################################
# S3 Object Store (headshots)
################################################################################

module "object_store" {
  source  = "./modules/object-store"

  bucket_name  = "${var.project_name}-headshots-${var.environment}"
  environment  = var.environment
}

################################################################################
# CloudFront CDN (serves headshots)
################################################################################

module "cdn" {
  source  = "./modules/cdn"

  s3_bucket_regional_domain = module.object_store.bucket_regional_domain
  s3_bucket_id               = module.object_store.bucket_id
  domain_name                = "cdn.${var.domain_name}"
  acm_certificate_arn        = module.dns.cdn_cert_arn
  environment                = var.environment
}

################################################################################
# DNS + TLS (Route53 + ACM)
################################################################################

module "dns" {
  source  = "./modules/dns"

  domain_name    = var.domain_name
  aws_region     = var.aws_region
  environment    = var.environment
}
