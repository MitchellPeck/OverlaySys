declare module "mammoth/mammoth.browser" {
  export function convertToMarkdown(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
}
