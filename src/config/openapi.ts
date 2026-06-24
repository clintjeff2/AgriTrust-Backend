export type OpenApiEnforcementMode = 'strict' | 'warning' | 'off';

export interface OpenApiConfig {
  mode: OpenApiEnforcementMode;
  specPaths: string[];
}

const mode = process.env.OPENAPI_ENFORCEMENT_MODE;
const normalizedMode: OpenApiEnforcementMode = mode === 'warning' ? 'warning' : mode === 'off' ? 'off' : 'strict';

const specPaths = process.env.OPENAPI_SPEC_PATHS
  ? process.env.OPENAPI_SPEC_PATHS.split(',').map((path) => path.trim()).filter(Boolean)
  : ['./src/openapi/v1.yaml', './src/openapi/v2.yaml'];

export const openApiConfig: OpenApiConfig = {
  mode: normalizedMode,
  specPaths,
};
