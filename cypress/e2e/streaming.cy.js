describe('Chat Stream Streaming Features', () => {
	beforeEach(() => {
		cy.visit('/')
		cy.waitForObsidianLoad()
		cy.checkPluginLoaded('chat-stream')

		// Enable streaming and set test API key
		cy.setPluginSettings({
			openaiApiKey: 'test-api-key',
			provider: 'OpenAI',
			enableStreaming: true,
			streamingUpdateInterval: 100,
			streamingChunkSize: 50,
			showStreamingProgress: true,
			enableStreamingControls: true
		})
	})

	it('should enable streaming mode', () => {
		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.enableStreaming).to.be.true
		})
	})

	it('should stream response content progressively', () => {
		cy.openCanvas()
		cy.addNoteToCanvas('Write a story about a robot')

		// Mock streaming response
		cy.intercept('POST', '**/chat/completions', (req) => {
			req.reply({
				statusCode: 200,
				headers: {
					'content-type': 'text/event-stream'
				},
				body: `data: {"choices": [{"delta": {"content": "Once upon a time"}}]}

data: {"choices": [{"delta": {"content": ", there was a robot"}}]}

data: {"choices": [{"delta": {"content": " named Zara."}}]}

data: [DONE]

`
			})
		}).as('streamRequest')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@streamRequest')

		// Verify streaming content appears progressively
		cy.get('.canvas-node').should('have.length', 2)
		cy.get('.canvas-node').last().should('contain', 'Once upon a time')
	})

	it('should show streaming progress indicators', () => {
		cy.setPluginSettings({
			showStreamingProgress: true,
			enableStreamingMetrics: true
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Generate progress test')

		cy.mockOpenAIResponse({
			choices: [
				{
					message: {
						content: 'This is a test response for progress indicators.'
					}
				}
			]
		})

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		// Look for progress indicators (these would be implementation-specific)
		cy.get('.streaming-progress', { timeout: 1000 }).should('exist')
	})

	it('should handle streaming with auto-split', () => {
		cy.setPluginSettings({
			enableStreaming: true,
			enableStreamingSplit: true,
			streamingChunkSize: 30
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Create multiple sections')

		const longResponse = {
			choices: [
				{
					message: {
						content: `# Section 1
This is the first section with some content.

# Section 2  
This is the second section with different content.

# Section 3
This is the third section with even more content.`
					}
				}
			]
		}

		cy.mockOpenAIResponse(longResponse)

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@openaiRequest')

		// Should create multiple nodes due to streaming split
		cy.get('.canvas-node').should('have.length.greaterThan', 2)
	})

	it('should provide streaming controls (pause/resume)', () => {
		cy.setPluginSettings({
			enableStreamingControls: true
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Test streaming controls')

		// Mock a longer streaming response
		cy.intercept('POST', '**/chat/completions', (req) => {
			req.reply({
				statusCode: 200,
				headers: {
					'content-type': 'text/event-stream'
				},
				body: `data: {"choices": [{"delta": {"content": "This is"}}]}

data: {"choices": [{"delta": {"content": " a long"}}]}

data: {"choices": [{"delta": {"content": " streaming"}}]}

data: {"choices": [{"delta": {"content": " response"}}]}

data: [DONE]

`
			})
		}).as('longStreamRequest')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		// Look for streaming control buttons
		cy.get('.streaming-controls', { timeout: 2000 }).should('exist')
		cy.get('.pause-streaming').should('exist')

		cy.wait('@longStreamRequest')
	})

	it('should retry on streaming errors', () => {
		cy.setPluginSettings({
			streamingRetryAttempts: 2,
			streamingTimeout: 5000
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Test retry mechanism')

		// Mock initial failure then success
		let callCount = 0
		cy.intercept('POST', '**/chat/completions', (req) => {
			callCount++
			if (callCount === 1) {
				req.reply({ statusCode: 500, body: 'Server error' })
			} else {
				req.reply({
					statusCode: 200,
					body: {
						choices: [
							{
								message: {
									content: 'Success after retry'
								}
							}
						]
					}
				})
			}
		}).as('retryRequest')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		// Should retry and eventually succeed
		cy.wait('@retryRequest')
		cy.wait('@retryRequest')

		cy.get('.canvas-node').should('have.length', 2)
	})

	it('should handle streaming timeout', () => {
		cy.setPluginSettings({
			streamingTimeout: 1000 // Very short timeout for testing
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Test timeout handling')

		// Mock a response that takes too long
		cy.intercept('POST', '**/chat/completions', (req) => {
			// Delay the response longer than timeout
			return new Promise((resolve) => {
				setTimeout(() => {
					resolve({
						statusCode: 200,
						body: {
							choices: [
								{
									message: {
										content: 'This response came too late'
									}
								}
							]
						}
					})
				}, 2000)
			})
		}).as('timeoutRequest')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		// Should handle timeout gracefully
		cy.get('.notice', { timeout: 3000 }).should('contain', 'timeout')
	})

	it('should track streaming metrics', () => {
		cy.setPluginSettings({
			enableStreamingMetrics: true
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Metrics test')

		cy.mockOpenAIResponse({
			choices: [
				{
					message: {
						content: 'Response for metrics tracking test.'
					}
				}
			]
		})

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@openaiRequest')

		// Check if metrics are logged (implementation-specific)
		cy.window().then((win) => {
			// This would depend on how metrics are implemented
			expect(win.console.debug).to.have.been.called
		})
	})
})
