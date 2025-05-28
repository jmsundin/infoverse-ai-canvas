import { CHAT_MODELS } from '../openai/chatGPT'
import { GEMINI_MODELS } from '../gemini/geminiAPI'

export const PROVIDERS = {
	OPENAI: 'OpenAI',
	GEMINI: 'Gemini'
}

export const ALL_MODELS = [
	...Object.values(CHAT_MODELS).map(m => ({ ...m, provider: PROVIDERS.OPENAI })),
	...Object.values(GEMINI_MODELS).map(m => ({ ...m, provider: PROVIDERS.GEMINI }))
]
