variable "identifier"         { type = string }
variable "engine_version"     { type = string }
variable "instance_class"     { type = string }
variable "db_name"            { type = string }
variable "username"           { type = string }
variable "vpc_id"             { type = string }
variable "subnet_ids"         { type = list(string) }
variable "allowed_sg_ids"     { type = list(string) }
variable "multi_az"           { type = bool; default = false }
variable "deletion_protection"{ type = bool; default = false }
variable "environment"        { type = string }
