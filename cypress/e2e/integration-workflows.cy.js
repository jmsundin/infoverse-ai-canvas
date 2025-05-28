describe('Chat Stream Integration Workflows', () => {
	beforeEach(() => {
		cy.visit('/')
		cy.waitForObsidianLoad()
		cy.checkPluginLoaded('chat-stream')
	})

	it('should complete a full chat conversation workflow', () => {
		// Set up initial settings
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.default)
		})

		// Mock conversation responses
		cy.fixture('api-responses').then((responses) => {
			cy.intercept('POST', '**/chat/completions', {
				statusCode: 200,
				body: responses.openai.simple_response
			}).as('conversationRequest')
		})

		// Start conversation
		cy.openCanvas()
		cy.addNoteToCanvas('What is machine learning?')

		// Generate first response
		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')
		cy.wait('@conversationRequest')

		// Verify response created
		cy.get('.canvas-node').should('have.length', 2)

		// Continue conversation
		cy.addNoteToCanvas('Can you give me examples?')
		cy.get('.canvas-node').last().click()
		cy.triggerCommand('Generate AI note')
		cy.wait('@conversationRequest')

		// Should have branching conversation
		cy.get('.canvas-node').should('have.length', 4)
	})

	it('should create mindmap from complex topic', () => {
		// Enable mindmap settings
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.mindmap_config)
		})

		// Mock mindmap response
		cy.fixture('api-responses').then((responses) => {
			cy.intercept('POST', '**/chat/completions', {
				statusCode: 200,
				body: responses.openai.mindmap_response
			}).as('mindmapRequest')
		})

		cy.openCanvas()
		cy.addNoteToCanvas(
			'Create a comprehensive mindmap about sustainable energy'
		)

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI mindmap')
		cy.wait('@mindmapRequest')

		// Should create multiple nodes for mindmap
		cy.get('.canvas-node').should('have.length.greaterThan', 3)

		// Verify mindmap structure
		cy.verifyCanvasNode('Main Topic')
		cy.verifyCanvasNode('Subtopic 1')
		cy.verifyCanvasNode('Subtopic 2')
	})

	it('should handle switching providers mid-conversation', () => {
		// Start with OpenAI
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.default)
		})

		cy.fixture('api-responses').then((responses) => {
			cy.intercept('POST', '**/chat/completions', {
				statusCode: 200,
				body: responses.openai.simple_response
			}).as('openaiRequest')
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Tell me about AI')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')
		cy.wait('@openaiRequest')

		// Switch to Gemini mid-conversation
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.gemini_provider)
		})

		cy.fixture('api-responses').then((responses) => {
			cy.intercept('POST', '**/generateContent*', {
				statusCode: 200,
				body: responses.gemini.simple_response
			}).as('geminiRequest')
		})

		cy.addNoteToCanvas('Now tell me about robotics')
		cy.get('.canvas-node').last().click()
		cy.triggerCommand('Generate AI note')
		cy.wait('@geminiRequest')

		// Should have responses from both providers
		cy.get('.canvas-node').should('have.length', 4)
		cy.verifyCanvasNode('simple test response from OpenAI')
		cy.verifyCanvasNode('simple test response from Gemini')
	})

	it('should handle large conversation trees with depth limits', () => {
		cy.setPluginSettings({
			openaiApiKey: 'test-api-key',
			provider: 'OpenAI',
			maxDepth: 3 // Limit conversation depth
		})

		// Mock responses for depth testing
		for (let i = 0; i < 5; i++) {
			cy.intercept('POST', '**/chat/completions', {
				statusCode: 200,
				body: {
					choices: [
						{
							message: {
								content: `Response at depth ${i + 1}`
							}
						}
					]
				}
			}).as(`depthRequest${i}`)
		}

		cy.openCanvas()
		cy.addNoteToCanvas('Start conversation')

		// Create deep conversation chain
		for (let depth = 0; depth < 4; depth++) {
			cy.get('.canvas-node').last().click()
			cy.triggerCommand('Generate AI note')
			cy.wait(`@depthRequest${depth}`)

			if (depth < 3) {
				cy.addNoteToCanvas(`Question at depth ${depth + 1}`)
			}
		}

		// Should respect max depth limit
		cy.get('.canvas-node').should('have.length.at.most', 7) // Original + 3 levels max
	})

	it('should handle concurrent API requests', () => {
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.default)
		})

		// Mock multiple concurrent responses
		cy.intercept('POST', '**/chat/completions', {
			statusCode: 200,
			body: {
				choices: [
					{
						message: {
							content: 'Concurrent response'
						}
					}
				]
			}
		}).as('concurrentRequest')

		cy.openCanvas()

		// Create multiple notes for concurrent requests
		cy.addNoteToCanvas('Question 1')
		cy.addNoteToCanvas('Question 2')
		cy.addNoteToCanvas('Question 3')

		// Trigger multiple requests simultaneously
		cy.get('.canvas-node').eq(0).click()
		cy.triggerCommand('Generate AI note')

		cy.get('.canvas-node').eq(1).click()
		cy.triggerCommand('Generate AI note')

		cy.get('.canvas-node').eq(2).click()
		cy.triggerCommand('Generate AI note')

		// Wait for all requests
		cy.wait('@concurrentRequest')
		cy.wait('@concurrentRequest')
		cy.wait('@concurrentRequest')

		// Should handle all responses
		cy.get('.canvas-node').should('have.length', 6)
	})

	it('should persist conversation state across plugin reload', () => {
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.default)
		})

		cy.fixture('api-responses').then((responses) => {
			cy.intercept('POST', '**/chat/completions', {
				statusCode: 200,
				body: responses.openai.simple_response
			}).as('persistenceRequest')
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Persistent conversation test')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')
		cy.wait('@persistenceRequest')

		// Simulate plugin reload
		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			return plugin.onunload().then(() => plugin.onload())
		})

		// Conversation should still be intact
		cy.get('.canvas-node').should('have.length', 2)
		cy.verifyCanvasNode('Persistent conversation test')
	})

	it('should handle streaming with interruption and recovery', () => {
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.streaming_enabled)
		})

		let requestCount = 0
		cy.intercept('POST', '**/chat/completions', (req) => {
			requestCount++
			if (requestCount === 1) {
				// First request fails mid-stream
				req.reply({
					statusCode: 200,
					headers: { 'content-type': 'text/event-stream' },
					body: `data: {"choices": [{"delta": {"content": "Partial"}}]}

data: {"error": "Connection interrupted"}

`
				})
			} else {
				// Recovery request succeeds
				req.reply({
					statusCode: 200,
					body: {
						choices: [
							{
								message: {
									content: 'Recovered response after interruption'
								}
							}
						]
					}
				})
			}
		}).as('streamingInterruption')

		cy.openCanvas()
		cy.addNoteToCanvas('Test streaming interruption')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		// Should handle interruption and retry
		cy.wait('@streamingInterruption')
		cy.wait('@streamingInterruption')

		cy.get('.canvas-node').should('have.length', 2)
	})

	it('should validate comprehensive settings workflow', () => {
		// Test complex settings workflow
		cy.openSettingsTab()

		// Change multiple settings
		cy.setPluginSettings({
			provider: 'OpenAI',
			temperature: 0.9,
			maxInputTokens: 2000,
			enableAutoSplit: true,
			enableStreaming: true,
			enableMindmapColorCoding: true,
			mindmapLayoutAlgorithm: 'hierarchical',
			debug: true
		})

		// Verify all settings applied
		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.provider).to.equal('OpenAI')
			expect(plugin.settings.temperature).to.equal(0.9)
			expect(plugin.settings.maxInputTokens).to.equal(2000)
			expect(plugin.settings.enableAutoSplit).to.be.true
			expect(plugin.settings.enableStreaming).to.be.true
			expect(plugin.settings.enableMindmapColorCoding).to.be.true
			expect(plugin.settings.mindmapLayoutAlgorithm).to.equal('hierarchical')
			expect(plugin.settings.debug).to.be.true
		})

		// Test settings persistence
		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			return plugin.saveSettings()
		})

		// Reload and verify persistence
		cy.reload()
		cy.waitForObsidianLoad()
		cy.checkPluginLoaded('chat-stream')

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.temperature).to.equal(0.9)
			expect(plugin.settings.enableAutoSplit).to.be.true
		})
	})
})
