// US regions documented for both Runtime and Bedrock API keys, checked 2026-09-09.
// https://docs.aws.amazon.com/general/latest/gr/bedrock.html
// https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-supported.html
export const bedrockRegions = [
 ['us-east-1', 'US East (N. Virginia)'], ['us-west-2', 'US West (Oregon)'],
] as const
export const bedrockEndpoint = (region: string) => `https://bedrock-runtime.${region}.amazonaws.com`
export const bedrockRegion = (endpoint: string) => /^https:\/\/bedrock-runtime\.([a-z0-9-]+)\.amazonaws\.com\/?$/.exec(endpoint)?.[1] ?? 'us-east-1'
