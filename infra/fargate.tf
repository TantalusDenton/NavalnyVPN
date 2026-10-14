data "aws_availability_zones" "portal" {
  state = "available"
}

locals {
  portal_subnets = {
    a = { cidr = "10.40.128.0/20", az = data.aws_availability_zones.portal.names[0] }
    b = { cidr = "10.40.144.0/20", az = data.aws_availability_zones.portal.names[1] }
  }
}

resource "aws_subnet" "portal" {
  for_each                = local.portal_subnets
  vpc_id                  = module.virginia.vpc_id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-portal-${each.key}" }
}

resource "aws_route_table_association" "portal" {
  for_each       = aws_subnet.portal
  subnet_id      = each.value.id
  route_table_id = module.virginia.public_route_table_id
}

resource "aws_ecr_repository" "portal" {
  name                 = "${var.project}/portal"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_dynamodb_table" "portal" {
  name         = "${var.project}-portal"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "user-profiles"
    projection_type = "ALL"
    key_schema {
      attribute_name = "gsi1pk"
      key_type       = "HASH"
    }
    key_schema {
      attribute_name = "gsi1sk"
      key_type       = "RANGE"
    }
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }
  deletion_protection_enabled = true
  tags                        = { Name = "${var.project}-portal-state" }
}

resource "aws_ecs_cluster" "portal" {
  name = "${var.project}-portal"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "portal" {
  name              = "/ecs/${var.project}/portal"
  retention_in_days = 30
}

resource "aws_iam_role" "portal_execution" {
  name = "${var.project}-portal-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }, ArnLike = { "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:*" } }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "portal_execution" {
  role       = aws_iam_role.portal_execution.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "portal_task" {
  name = "${var.project}-portal-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }, ArnLike = { "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:ecs:us-east-1:${data.aws_caller_identity.current.account_id}:*" } }
    }]
  })
}

resource "aws_iam_role_policy" "portal_task" {
  role = aws_iam_role.portal_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "GatewayOperations", Effect = "Allow", Action = ["ssm:SendCommand"], Resource = concat([for g in local.gateways : g.instanceArn], [for g in local.gateways : g.documentArn]) },
      { Sid = "ReadCommandStatus", Effect = "Allow", Action = ["ssm:GetCommandInvocation"], Resource = "*" },
      { Sid = "RetrieveProfiles", Effect = "Allow", Action = ["s3:GetObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.artifacts.arn}/profiles/*" },
      { Sid = "PortalState", Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:TransactWriteItems"], Resource = [aws_dynamodb_table.portal.arn, "${aws_dynamodb_table.portal.arn}/index/*"] }
    ]
  })
}

resource "aws_security_group" "portal_alb" {
  name_prefix = "${var.project}-portal-alb-"
  description = "Private load balancer reachable only from the public TLS proxy."
  vpc_id      = module.virginia.vpc_id
}

resource "aws_security_group" "portal_tasks" {
  name_prefix = "${var.project}-portal-tasks-"
  description = "Portal containers accept traffic only from the internal load balancer."
  vpc_id      = module.virginia.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "portal_alb_from_proxy" {
  security_group_id            = aws_security_group.portal_alb.id
  referenced_security_group_id = aws_security_group.control.id
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
}

resource "aws_vpc_security_group_egress_rule" "portal_alb_to_tasks" {
  security_group_id            = aws_security_group.portal_alb.id
  referenced_security_group_id = aws_security_group.portal_tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
}

resource "aws_vpc_security_group_ingress_rule" "portal_tasks_from_alb" {
  security_group_id            = aws_security_group.portal_tasks.id
  referenced_security_group_id = aws_security_group.portal_alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
}

resource "aws_vpc_security_group_egress_rule" "portal_tasks_egress" {
  security_group_id = aws_security_group.portal_tasks.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_lb" "portal" {
  name                       = "${var.project}-portal"
  internal                   = true
  load_balancer_type         = "application"
  subnets                    = [for subnet in aws_subnet.portal : subnet.id]
  security_groups            = [aws_security_group.portal_alb.id]
  drop_invalid_header_fields = true
  depends_on                 = [aws_route_table_association.portal]
}

resource "aws_lb_target_group" "portal" {
  name                 = "${var.project}-portal"
  port                 = 3001
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = module.virginia.vpc_id
  deregistration_delay = 30
  health_check {
    enabled             = true
    path                = "/api/health"
    matcher             = "200"
    interval            = 20
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "portal" {
  load_balancer_arn = aws_lb.portal.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.portal.arn
  }
}

locals {
  portal_runtime = merge(local.runtime, {
    awsRegion     = "us-east-1"
    databaseTable = aws_dynamodb_table.portal.name
  })
}

resource "aws_ecs_task_definition" "portal" {
  family                   = "${var.project}-portal"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.portal_execution.arn
  task_role_arn            = aws_iam_role.portal_task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = "portal"
    image        = "${aws_ecr_repository.portal.repository_url}:${var.app_image_tag}"
    essential    = true
    portMappings = [{ containerPort = 3001, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "HOST", value = "0.0.0.0" },
      { name = "PORT", value = "3001" },
      { name = "APP_ORIGIN", value = "https://${var.domain}" },
      { name = "AUTH_MODE", value = "cognito" },
      { name = "PROVISIONER", value = "aws" },
      { name = "AWS_REGION", value = "us-east-1" },
      { name = "DATABASE_TABLE", value = aws_dynamodb_table.portal.name },
      { name = "RUNTIME_CONFIG_JSON", value = jsonencode(local.portal_runtime) }
    ]
    healthCheck = {
      command  = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval = 30, timeout = 5, retries = 3, startPeriod = 60
    }
    readonlyRootFilesystem = true
    user                   = "node"
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.portal.name
        awslogs-region        = "us-east-1"
        awslogs-stream-prefix = "portal"
      }
    }
  }])
}

resource "aws_ecs_service" "portal" {
  count                              = var.portal_service_enabled ? 1 : 0
  name                               = "portal"
  cluster                            = aws_ecs_cluster.portal.id
  task_definition                    = aws_ecs_task_definition.portal.arn
  desired_count                      = var.portal_min_tasks
  launch_type                        = "FARGATE"
  platform_version                   = "LATEST"
  enable_execute_command             = false
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 90
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [for subnet in aws_subnet.portal : subnet.id]
    security_groups  = [aws_security_group.portal_tasks.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.portal.arn
    container_name   = "portal"
    container_port   = 3001
  }
  depends_on = [aws_lb_listener.portal, aws_iam_role_policy.portal_task, aws_iam_role_policy_attachment.portal_execution]
}

resource "aws_appautoscaling_target" "portal" {
  count              = var.portal_service_enabled ? 1 : 0
  min_capacity       = var.portal_min_tasks
  max_capacity       = var.portal_max_tasks
  resource_id        = "service/${aws_ecs_cluster.portal.name}/${aws_ecs_service.portal[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "portal_cpu" {
  count              = var.portal_service_enabled ? 1 : 0
  name               = "${var.project}-portal-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.portal[0].resource_id
  scalable_dimension = aws_appautoscaling_target.portal[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.portal[0].service_namespace
  target_tracking_scaling_policy_configuration {
    target_value       = var.portal_cpu_target
    scale_in_cooldown  = 180
    scale_out_cooldown = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
  }
}

resource "aws_appautoscaling_policy" "portal_memory" {
  count              = var.portal_service_enabled ? 1 : 0
  name               = "${var.project}-portal-memory"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.portal[0].resource_id
  scalable_dimension = aws_appautoscaling_target.portal[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.portal[0].service_namespace
  target_tracking_scaling_policy_configuration {
    target_value       = var.portal_memory_target
    scale_in_cooldown  = 180
    scale_out_cooldown = 60
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageMemoryUtilization" }
  }
}
