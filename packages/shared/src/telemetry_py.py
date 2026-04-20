"""
OpenTelemetry SDK initialiser — shared across all Python services.

Usage (call at the top of main.py before importing anything else):

    from shared.telemetry_py import init_telemetry
    init_telemetry(service_name="sag")

Environment variables:
    OTEL_EXPORTER_OTLP_ENDPOINT  (default: http://localhost:4318)
    OTEL_SERVICE_VERSION         (default: "dev")
    OTEL_SERVICE_NAME            (can override service_name argument)
"""

from __future__ import annotations

import os

from opentelemetry import metrics, trace
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.propagate import set_global_textmap
from opentelemetry.propagators.composite import CompositePropagator
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import SERVICE_NAME, SERVICE_VERSION, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

_initialised = False


def init_telemetry(service_name: str, service_version: str | None = None) -> None:
    """Initialise OTel SDK. Idempotent — safe to call multiple times."""
    global _initialised
    if _initialised:
        return

    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
    version = service_version or os.environ.get("OTEL_SERVICE_VERSION", "dev")
    svc_name = os.environ.get("OTEL_SERVICE_NAME", service_name)

    resource = Resource.create({
        SERVICE_NAME: svc_name,
        SERVICE_VERSION: version,
        "deployment.environment": os.environ.get("ENV", "development"),
    })

    # Trace provider
    trace_exporter = OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")
    tracer_provider = TracerProvider(resource=resource)
    tracer_provider.add_span_processor(BatchSpanProcessor(trace_exporter))
    trace.set_tracer_provider(tracer_provider)

    # Metric provider
    metric_exporter = OTLPMetricExporter(endpoint=f"{endpoint}/v1/metrics")
    metric_reader = PeriodicExportingMetricReader(
        exporter=metric_exporter,
        export_interval_millis=15_000,
    )
    meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
    metrics.set_meter_provider(meter_provider)

    # W3C TraceContext + Baggage propagation
    set_global_textmap(CompositePropagator(propagators=[
        TraceContextTextMapPropagator(),
        W3CBaggagePropagator(),
    ]))

    _initialised = True


def get_tracer(name: str) -> trace.Tracer:
    return trace.get_tracer(name)


def get_meter(name: str) -> metrics.Meter:
    return metrics.get_meter(name)
