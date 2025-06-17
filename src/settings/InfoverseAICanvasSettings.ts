import { CHAT_MODELS, OPENAI_COMPLETIONS_URL } from 'src/openai/chatGPT'
import { GEMINI_MODELS } from 'src/gemini/geminiAPI'
import { ALL_MODELS } from 'src/models/providers'

export interface InfoverseAICanvasSettings {
	/**
	 * The API key to use when making requests (deprecated - use provider-specific keys)
	 */
	apiKey: string

	/**
	 * The OpenAI API key
	 */
	openaiApiKey: string

	/**
	 * The Gemini API key
	 */
	geminiApiKey: string

	/**
	 * The URL endpoint for chat
	 */
	apiUrl: string

	/**
	 * The GPT model to use
	 */
	apiModel: string

	/**
	 * The provider (OpenAI or Gemini)
	 */
	provider: string

	/**
	 * Last selected OpenAI model (for restoring when switching back)
	 */
	lastOpenAIModel: string

	/**
	 * Last selected Gemini model (for restoring when switching back)
	 */
	lastGeminiModel: string

	/**
	 * The temperature to use when generating responses (0-2). 0 means no randomness.
	 */
	temperature: number

	/**
	 * The system prompt sent with each request to the API
	 */
	systemPrompt: string

	/**
	 * Enable debug output in the console
	 */
	debug: boolean

	/**
	 * The maximum number of tokens to send (up to model limit). 0 means as many as possible.
	 */
	maxInputTokens: number

	/**
	 * The maximum number of tokens to return from the API. 0 means no limit. (A token is about 4 characters).
	 */
	maxResponseTokens: number

	/**
	 * The maximum depth of ancestor notes to include. 0 means no limit.
	 */
	maxDepth: number

	/**
	 * Automatically split AI responses into multiple logical notes (mindmap style)
	 */
	enableAutoSplit: boolean

	/**
	 * Maximum number of notes to create when auto-splitting (prevents too many small notes)
	 */
	maxSplitNotes: number

	/**
	 * Color theme for mindmap nodes (1-6 for different colors)
	 */
	mindmapColorTheme: string

	/**
	 * Enable different colors for different types of content in mindmap
	 */
	enableMindmapColorCoding: boolean

	/**
	 * Mindmap node spacing/layout density (compact, normal, spacious)
	 */
	mindmapSpacing: 'compact' | 'normal' | 'spacious'

	/**
	 * Mindmap layout algorithm (radial, hierarchical, organic, force)
	 */
	mindmapLayoutAlgorithm: 'radial' | 'hierarchical' | 'organic' | 'force'
}

export const DEFAULT_SYSTEM_PROMPT = `
	You are a critical-thinking assistant bot.
	Consider the intent of my questions before responding.
	Do not restate my information unless I ask for it.
	Do not include caveats or disclaimers.
	Use step-by-step reasoning. Be brief.

	Your entire response MUST be formatted using Markdown, strictly adhering to the structural guidelines below. This structure is specifically designed to allow the output to be easily visualized as a mind map or graph, where headers represent nodes and content represents node details.

	---
	**CRITICAL: Output ONLY the Markdown-formatted answer according to the structure below. Do NOT include any introductory sentences, concluding remarks, or any other text outside of this defined Markdown structure.**
	---

	**Formatting Guidelines:**

	1.  **Main Topics (Root Nodes):**
		*   Identify the main topics or primary aspects of your answer. These will form the main branches/root nodes.
		*   Use a Level 2 Markdown header for each main topic (e.g., \`## Main Topic Title\`).

	2.  **Sub-Topics (Child Nodes):**
		*   For each main topic, identify relevant sub-topics, supporting details, steps, or components. These will be child nodes.
		*   Use Level 3 Markdown headers for sub-topics (e.g., \`### Sub-Topic Title\`), nested under the appropriate \`##\` header.
		*   For further nesting (grandchild nodes, etc.), use Level 4 (\`####\`), Level 5 (\`#####\`), and Level 6 (\`######\`) Markdown headers as needed, maintaining the hierarchy.

	3.  **Header Formatting:**
		*   Each Markdown header (\`##\`, \`###\`, etc.) MUST be followed by a single space and then the concise title for that node/section.

	4.  **Content Placement:**
		*   Present the content (explanation, data, examples, etc.) for each node directly *under* its corresponding header.

	5.  **Hierarchical Clarity:**
		*   Ensure a clear, logical hierarchical structure that visually reflects the relationships between concepts in your answer.

	6.  **Spacing:**
		*   Ensure a single newline character after each node's content before the next header (if any).

	**Example of Expected Structure:**

	\`\`\`markdown
	## Main Topic 1
	Content for main topic 1. This could be a short paragraph.

	### Sub-Topic 1.1
	Content for sub-topic 1.1.

	#### Sub-Sub-Topic 1.1.1
	Content for sub-sub-topic 1.1.1.

	### Sub-Topic 1.2
	Content for sub-topic 1.2.

	## Main Topic 2
	Content for main topic 2.
	\`\`\`
`.trim()

export const DEFAULT_SETTINGS: InfoverseAICanvasSettings = {
	apiKey: '',
	openaiApiKey: '',
	geminiApiKey: '',
	apiUrl: OPENAI_COMPLETIONS_URL,
	apiModel: CHAT_MODELS.GPT_35_TURBO.name,
	provider: 'OpenAI',
	lastOpenAIModel: CHAT_MODELS.GPT_35_TURBO.name,
	lastGeminiModel: '',
	temperature: 1,
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	debug: false,
	maxInputTokens: 0,
	maxResponseTokens: 0,
	maxDepth: 0,
	enableAutoSplit: false,
	maxSplitNotes: 6,
	mindmapColorTheme: '6',
	enableMindmapColorCoding: false,
	mindmapSpacing: 'normal',
	mindmapLayoutAlgorithm: 'organic',
}

export function getModels() {
	return ALL_MODELS.map(model => ({
		name: model.name,
		provider: model.provider
	}))
}

export function getModelsByProvider(provider: string) {
	if (provider === 'OpenAI') {
		return Object.values(CHAT_MODELS).map(model => model.name)
	} else if (provider === 'Gemini') {
		return Object.values(GEMINI_MODELS).map(model => model.name)
	}
	return []
}
