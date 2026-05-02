output "eks_cluster_name" {
  description = "EKS cluster name — use to configure kubectl"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS API server endpoint"
  value       = module.eks.cluster_endpoint
  sensitive   = true
}

output "rds_endpoint" {
  description = "Postgres RDS endpoint (write)"
  value       = module.postgres.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = module.redis.primary_endpoint
  sensitive   = true
}

output "cdn_domain" {
  description = "CloudFront CDN domain for headshots"
  value       = module.cdn.domain_name
}

output "s3_bucket_name" {
  description = "S3 headshots bucket name"
  value       = module.object_store.bucket_id
}

output "nameservers" {
  description = "Route53 nameservers — point your domain registrar here"
  value       = module.dns.nameservers
}

output "kubeconfig_command" {
  description = "Run this to configure kubectl"
  value       = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}
