{{/*
Expand the name of the chart.
*/}}
{{- define "server-info.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name. Honors fullnameOverride so resource names stay
"server-info" (matching the previous kustomize output).
*/}}
{{- define "server-info.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "server-info.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every object.
*/}}
{{- define "server-info.labels" -}}
helm.sh/chart: {{ include "server-info.chart" . }}
{{ include "server-info.selectorLabels" . }}
app.kubernetes.io/part-of: server-info
app.kubernetes.io/component: web
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — the immutable subset used in spec.selector / podSelector.
*/}}
{{- define "server-info.selectorLabels" -}}
app.kubernetes.io/name: {{ include "server-info.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name to use.
*/}}
{{- define "server-info.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "server-info.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
