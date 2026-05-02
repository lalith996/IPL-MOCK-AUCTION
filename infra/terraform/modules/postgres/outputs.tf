output "endpoint"         { value = aws_db_instance.main.endpoint; sensitive = true }
output "db_name"          { value = aws_db_instance.main.db_name }
output "username"         { value = aws_db_instance.main.username }
output "ssm_password_arn" { value = aws_ssm_parameter.db_password.arn }
