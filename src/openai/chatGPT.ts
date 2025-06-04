import { request, RequestUrlParam } from 'obsidian'
import OpenAI from 'openai'
import { openai } from './chatGPT-types'

export const OPENAI_COMPLETIONS_URL = `https://api.openai.com/v1/chat/completions`

export type ChatModelSettings = {
	name: string,
	tokenLimit: number,
	encodingFrom?: string
}

export const CHAT_MODELS = {
	GPT_35_TURBO: {
		name: 'gpt-3.5-turbo',
		tokenLimit: 4096
	},
	GPT_35_TURBO_0125: {
		name: 'gpt-3.5-turbo-0125',
		tokenLimit: 16385
	},
	GPT_35_16K: {
		name: 'gpt-3.5-turbo-16k',
		tokenLimit: 16385
	},
	GPT_35_TURBO_1106: {
		name: 'gpt-3.5-turbo-1106',
		tokenLimit: 16385
	},
	GPT_4o: {
		name: 'gpt-4o',
		tokenLimit: 128000
	},
	GPT_4o_MINI: {
		name: 'gpt-4o-mini',
		encodingFrom: 'gpt-4o',
		tokenLimit: 16384
	},
	GPT_4: {
		name: 'gpt-4',
		tokenLimit: 8192
	},
	GPT_4_TURBO_PREVIEW: {
		name: 'gpt-4-turbo-preview',
		tokenLimit: 128000
	},
	GPT_4_0125_PREVIEW: {
		name: 'gpt-4-0125-preview',
		tokenLimit: 128000
	},
	GPT_4_1106_PREVIEW: {
		name: 'gpt-4-1106-preview',
		tokenLimit: 128000
	},
	GPT_4_0613: {
		name: 'gpt-4-0613',
		tokenLimit: 8192
	},
	GPT_4_32K: {
		name: 'gpt-4-32k',
		tokenLimit: 32768
	},
	GPT_4_32K_0613: {
		name: 'gpt-4-32k-0613',
		tokenLimit: 32768
	}
}

export type ChatGPTModel = keyof typeof CHAT_MODELS

export function chatModelByName(name: string) {
	return Object.values(CHAT_MODELS).find((model) => model.name === name)
}

export const defaultChatGPTSettings: Partial<openai.CreateChatCompletionRequest> =
{
	model: CHAT_MODELS.GPT_35_TURBO.name,
	max_tokens: 500,
	temperature: 0,
	top_p: 1.0,
	presence_penalty: 0,
	frequency_penalty: 0,
	stop: []
}

export async function getChatGPTCompletion(
	apiKey: string,
	apiUrl: string,
	model: openai.CreateChatCompletionRequest['model'],
	messages: openai.CreateChatCompletionRequest['messages'],
	settings?: Partial<
		Omit<openai.CreateChatCompletionRequest, 'messages' | 'model'>
	>
): Promise<string | undefined> {
	const headers = {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json'
	}
	const body: openai.CreateChatCompletionRequest = {
		messages,
		model,
		...settings
	}
	const requestParam: RequestUrlParam = {
		url: apiUrl,
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify(body),
		headers
	}
	console.debug('Calling openAI', requestParam)
	const res: openai.CreateChatCompletionResponse | undefined = await request(
		requestParam
	)
		.then((response) => {
			return JSON.parse(response)
		})
		.catch((err) => {
			console.error(err)
			if (err.code === 429) {
				console.error(
					'OpenAI API rate limit exceeded. If you have free account, your credits may have been consumed or expired.'
				)
			}
		})
	return res?.choices?.[0]?.message?.content
}

/**
 * Original streaming completion for OpenAI with real-time token delivery
 */
export async function getChatGPTStreamingCompletion(
	apiKey: string,
	apiUrl: string,
	model: openai.CreateChatCompletionRequest['model'],
	messages: openai.CreateChatCompletionRequest['messages'],
	onToken: (token: string) => void,
	onComplete: (fullText: string) => void,
	onError: (error: Error) => void,
	settings?: Partial<
		Omit<openai.CreateChatCompletionRequest, 'messages' | 'model' | 'stream'>
	>,
	timeoutMs = 30000 // 30 second default timeout
): Promise<void> {
	const headers = {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json',
		'Accept': 'text/event-stream'
	}

	const body: openai.CreateChatCompletionRequest = {
		messages,
		model,
		stream: true,
		...settings
	}

	console.debug('Calling OpenAI streaming', { url: apiUrl, model, messagesCount: messages.length, timeout: timeoutMs })

	let fullText = ''
	let buffer = ''
	let lastActivityTime = Date.now()

	try {
		// Create AbortController for timeout handling
		const controller = new AbortController()
		const timeoutId = setTimeout(() => {
			controller.abort()
		}, timeoutMs)

		// Using fetch instead of Obsidian's request for streaming support
		const response = await fetch(apiUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: controller.signal
		})

		// Clear timeout on successful connection
		clearTimeout(timeoutId)

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error')
			throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`)
		}

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error('No response body reader available')
		}

		const decoder = new TextDecoder()
		let iterations = 0
		const maxIterations = 10000 // Safety limit to prevent infinite loops

		let done = false
		while (!done && iterations < maxIterations) {
			// Set up timeout for individual chunk reads
			const chunkTimeoutId = setTimeout(() => {
				reader.cancel()
				onError(new Error('Chunk read timeout - connection may be stalled'))
			}, 10000) // 10 second timeout per chunk

			try {
				const result = await reader.read()
				clearTimeout(chunkTimeoutId)

				done = result.done
				lastActivityTime = Date.now()

				if (done) break

				buffer += decoder.decode(result.value, { stream: true })

				// Process complete lines
				const lines = buffer.split('\n')
				buffer = lines.pop() || '' // Keep incomplete line in buffer

				for (const line of lines) {
					const trimmedLine = line.trim()

					if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue

					const data = trimmedLine.slice(6) // Remove 'data: '

					if (data === '[DONE]') {
						onComplete(fullText)
						return
					}

					try {
						const parsed: openai.CreateChatCompletionDeltaResponse = JSON.parse(data)
						const content = parsed.choices?.[0]?.delta?.content

						if (content) {
							fullText += content
							onToken(content)
						}

						// Check for finish_reason
						const finishReason = parsed.choices?.[0]?.finish_reason
						if (finishReason && finishReason !== 'null') {
							console.debug('Stream finished with reason:', finishReason)
						}
					} catch (parseError) {
						console.warn('Failed to parse streaming response:', parseError, data)
						// Don't fail on individual parse errors, continue processing
					}
				}
			} catch (chunkError) {
				clearTimeout(chunkTimeoutId)
				if (chunkError.name === 'AbortError') {
					throw new Error('Chunk read was aborted due to timeout')
				}
				throw chunkError
			}

			iterations++

			// Check for stalled connection
			if (Date.now() - lastActivityTime > 15000) { // 15 seconds of no activity
				throw new Error('Connection appears to be stalled - no data received')
			}
		}

		if (iterations >= maxIterations) {
			console.warn('Exceeded max iterations in streaming completion')
			throw new Error('Stream processing exceeded maximum iterations limit')
		}

		onComplete(fullText)
	} catch (error) {
		console.error('OpenAI streaming error:', error)

		// Provide more specific error messages
		if (error.name === 'AbortError') {
			onError(new Error(`Request timeout after ${timeoutMs}ms`))
		} else if (error.message?.includes('fetch')) {
			onError(new Error(`Network error: ${error.message}`))
		} else {
			onError(error instanceof Error ? error : new Error(String(error)))
		}
	}
}

/**
 * Enhanced streaming completion using the official OpenAI SDK with typewriter effect
 */
export async function getChatGPTStreamingCompletionWithSDK(
	apiKey: string,
	apiUrl: string,
	model: openai.CreateChatCompletionRequest['model'],
	messages: openai.CreateChatCompletionRequest['messages'],
	onToken: (token: string) => void,
	onComplete: (fullText: string) => void,
	onError: (error: Error) => void,
	settings?: Partial<
		Omit<openai.CreateChatCompletionRequest, 'messages' | 'model' | 'stream'>
	>,
	typewriterOptions?: {
		enabled?: boolean
		speed?: number // milliseconds between characters
		chunkSize?: number // characters per chunk
	}
): Promise<void> {
	const typewriter = {
		enabled: true,
		speed: 20, // 20ms between characters for smooth typewriter effect
		chunkSize: 1, // 1 character at a time for true typewriter effect
		...typewriterOptions
	}

	try {
		console.log('getChatGPTStreamingCompletionWithSDK called with typewriter effect')
		console.debug('Calling OpenAI streaming with SDK', {
			model,
			messagesCount: messages.length,
			typewriter
		})

		// Initialize OpenAI client
		const openaiClient = new OpenAI({
			apiKey: apiKey,
			baseURL: apiUrl.replace('/chat/completions', ''), // Extract base URL
			dangerouslyAllowBrowser: true // Allow in browser/Electron environment
		})

		const stream = await openaiClient.chat.completions.create({
			model: model as string,
			messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
			stream: true,
			temperature: settings?.temperature ?? undefined,
			max_tokens: settings?.max_tokens ?? undefined,
			top_p: settings?.top_p ?? undefined,
			frequency_penalty: settings?.frequency_penalty ?? undefined,
			presence_penalty: settings?.presence_penalty ?? undefined,
			stop: settings?.stop ?? undefined,
			n: settings?.n ?? undefined
		} as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)

		let fullText = ''
		let pendingTokens = ''
		let isProcessingTypewriter = false

		// Typewriter effect function
		const processTypewriterEffect = async () => {
			if (isProcessingTypewriter || !pendingTokens) return

			isProcessingTypewriter = true

			while (pendingTokens.length > 0) {
				const chunk = pendingTokens.slice(0, typewriter.chunkSize)
				pendingTokens = pendingTokens.slice(typewriter.chunkSize)

				onToken(chunk)

				if (typewriter.speed > 0 && pendingTokens.length > 0) {
					await new Promise(resolve => setTimeout(resolve, typewriter.speed))
				}
			}

			isProcessingTypewriter = false
		}

		// Process the stream
		for await (const chunk of stream) {
			const content = chunk.choices[0]?.delta?.content

			if (content) {
				fullText += content

				if (typewriter.enabled) {
					// Add to pending tokens for typewriter effect
					pendingTokens += content

					// Start processing typewriter effect if not already running
					if (!isProcessingTypewriter) {
						processTypewriterEffect()
					}
				} else {
					// Direct output without typewriter effect
					onToken(content)
				}
			}

			// Check for completion
			const finishReason = chunk.choices[0]?.finish_reason
			if (finishReason && finishReason !== null) {
				console.debug('Stream finished with reason:', finishReason)
				break
			}
		}

		// Wait for any remaining typewriter tokens to be processed
		if (typewriter.enabled) {
			while (pendingTokens.length > 0 || isProcessingTypewriter) {
				await new Promise(resolve => setTimeout(resolve, 10))
			}
		}

		onComplete(fullText)
		console.log('OpenAI SDK streaming completed with typewriter effect, full text length:', fullText.length)

	} catch (error) {
		console.error('OpenAI SDK streaming error:', error)

		let errorMessage = 'Error streaming from OpenAI.'
		if (error instanceof Error) {
			errorMessage += ` ${error.message}`
		}

		// Handle specific OpenAI SDK errors
		if (error instanceof OpenAI.APIError) {
			errorMessage = `OpenAI API Error: ${error.message}`
			if (error.status === 401) {
				errorMessage += ' Please check your API key.'
			} else if (error.status === 429) {
				errorMessage += ' Rate limit exceeded. Please try again later.'
			} else if (error.status === 500) {
				errorMessage += ' OpenAI server error. Please try again later.'
			}
		}

		onError(new Error(errorMessage))
	}
}

/**
 * WebSocket-style streaming with enhanced real-time features
 * Provides the most responsive streaming experience possible
 */
export async function getChatGPTWebSocketStyleStreaming(
	apiKey: string,
	apiUrl: string,
	model: openai.CreateChatCompletionRequest['model'],
	messages: openai.CreateChatCompletionRequest['messages'],
	onToken: (token: string) => void,
	onComplete: (fullText: string) => void,
	onError: (error: Error) => void,
	onProgress?: (progress: { tokens: number; estimatedTotal?: number }) => void,
	settings?: Partial<
		Omit<openai.CreateChatCompletionRequest, 'messages' | 'model' | 'stream'>
	>
): Promise<void> {
	const wsOptions = {
		bufferSize: 0, // No buffering for maximum responsiveness
		heartbeat: true,
		reconnect: false,
		maxChunkDelay: 5 // Maximum 5ms delay between chunks
	}

	try {
		console.log('getChatGPTWebSocketStyleStreaming called')
		console.debug('WebSocket-style OpenAI streaming', {
			model,
			messagesCount: messages.length,
			wsOptions
		})

		// Use fetch with AbortController for WebSocket-like control
		const controller = new AbortController()
		let tokenCount = 0
		let fullText = ''
		let lastChunkTime = Date.now()

		const headers = {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'Accept': 'text/event-stream',
			'Cache-Control': 'no-cache'
		}

		const body: openai.CreateChatCompletionRequest = {
			messages,
			model,
			stream: true,
			...settings
		}

		const response = await fetch(apiUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: controller.signal
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const reader = response.body?.getReader()
		if (!reader) {
			throw new Error('No response body reader available')
		}

		const decoder = new TextDecoder()
		let buffer = ''

		// Heartbeat to ensure connection stays alive
		const heartbeatInterval = setInterval(() => {
			if (Date.now() - lastChunkTime > 30000) { // 30 seconds of silence
				console.warn('WebSocket-style connection may be stale')
			}
		}, 5000)

		try {
			let done = false
			while (!done) {
				const { value, done: readerDone } = await reader.read()
				done = readerDone

				if (done) break

				lastChunkTime = Date.now()
				buffer += decoder.decode(value, { stream: true })

				// Process lines immediately for WebSocket-like responsiveness
				const lines = buffer.split('\n')
				buffer = lines.pop() || ''

				for (const line of lines) {
					const trimmedLine = line.trim()

					if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue

					const data = trimmedLine.slice(6)

					if (data === '[DONE]') {
						clearInterval(heartbeatInterval)
						onComplete(fullText)
						return
					}

					try {
						const parsed: openai.CreateChatCompletionDeltaResponse = JSON.parse(data)
						const content = parsed.choices?.[0]?.delta?.content

						if (content) {
							fullText += content
							tokenCount++

							// Immediate token delivery for WebSocket-like responsiveness
							onToken(content)

							// Optional progress reporting
							if (onProgress) {
								onProgress({
									tokens: tokenCount,
									estimatedTotal: settings?.max_tokens
								})
							}
						}

						const finishReason = parsed.choices?.[0]?.finish_reason
						if (finishReason && finishReason !== null) {
							console.debug('WebSocket-style stream finished:', finishReason)
							break
						}
					} catch (parseError) {
						console.warn('Parse error in WebSocket-style stream:', parseError)
						// Continue processing other chunks
					}
				}

				// Yield control to prevent blocking
				if (Date.now() - lastChunkTime > wsOptions.maxChunkDelay) {
					await new Promise(resolve => setTimeout(resolve, 0))
				}
			}

		} finally {
			clearInterval(heartbeatInterval)
		}

		onComplete(fullText)
		console.log('WebSocket-style streaming completed, tokens:', tokenCount)

	} catch (error) {
		console.error('WebSocket-style streaming error:', error)

		if (error.name === 'AbortError') {
			onError(new Error('WebSocket-style stream was aborted'))
		} else {
			onError(error instanceof Error ? error : new Error(String(error)))
		}
	}
}
