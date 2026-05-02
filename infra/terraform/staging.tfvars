# Staging environment overrides
# Usage: terraform apply -var-file=staging.tfvars

environment             = "staging"
aws_region              = "ap-south-1"
domain_name             = "staging.ipl-auction.example.com"   # change to your domain
postgres_instance_class = "db.t3.medium"
redis_node_type         = "cache.t3.micro"
vpc_cidr                = "10.1.0.0/16"

eks_node_groups = {
  general = {
    instance_types = ["t3.medium"]
    min_size       = 2
    desired_size   = 2
    max_size       = 6
    capacity_type  = "ON_DEMAND"
  }
}
