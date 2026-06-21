// Prompt text lives in .txt files under agent/prompts and is imported as a
// string. Bun's text loader inlines the content into the bundle at build time
// (the shipped dist/ has no loose .txt to read), so these imports are static.
declare module "*.txt" {
  const content: string;
  export default content;
}
