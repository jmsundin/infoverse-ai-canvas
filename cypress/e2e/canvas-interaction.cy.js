describe('Chat Stream Canvas Interaction', () => {
	beforeEach(() => {
		cy.visit('/')
		cy.waitForObsidianLoad()
		cy.checkPluginLoaded('chat-stream')

		// Set up test API key
		cy.setPluginSettings({
			openaiApiKey: 'test-api-key',
			provider: 'OpenAI',
			temperature: 0.7
		})
	})

	it('should create a canvas and add initial note', () => {
		cy.openCanvas()
		cy.addNoteToCanvas('What is artificial intelligence?')

		cy.verifyCanvasNode('What is artificial intelligence?')
	})

	it('should trigger next note command', () => {
		cy.openCanvas()
		cy.addNoteToCanvas('Tell me about machine learning')

		// Mock API response
		cy.mockOpenAIResponse({
			choices: [
				{
					message: {
						content:
							'Machine learning is a subset of artificial intelligence...'
					}
				}
			]
		})

		// Select the note and trigger next note command
		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Create next note')

		// Verify API was called
		cy.wait('@openaiRequest')
	})

	it('should generate AI note with API response', () => {
		cy.openCanvas()
		cy.addNoteToCanvas('Explain quantum computing')

		const mockResponse = {
			choices: [
				{
					message: {
						content:
							'Quantum computing leverages quantum mechanical phenomena...'
					}
				}
			]
		}

		cy.mockOpenAIResponse(mockResponse)

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@openaiRequest')

		// Verify new note appears on canvas
		cy.get('.canvas-node').should('have.length', 2)
	})

	it('should generate mindmap with multiple nodes', () => {
		cy.openCanvas()
		cy.addNoteToCanvas('Create a mindmap about renewable energy')

		// Mock response for mindmap with multiple sections
		const mockResponse = {
			choices: [
				{
					message: {
						content: `# Solar Energy
Solar panels convert sunlight to electricity

# Wind Energy  
Wind turbines generate power from wind

# Hydroelectric
Dams harness water flow for electricity`
					}
				}
			]
		}

		cy.mockOpenAIResponse(mockResponse)

		// Enable auto-split for mindmap generation
		cy.setPluginSettings({
			enableAutoSplit: true,
			maxSplitNotes: 6
		})

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI mindmap')

		cy.wait('@openaiRequest')

		// Verify multiple nodes were created
		cy.get('.canvas-node').should('have.length.greaterThan', 1)
	})

	it('should handle API errors gracefully', () => {
		cy.openCanvas()
		cy.addNoteToCanvas('Test error handling')

		// Mock API error response
		cy.intercept('POST', '**/chat/completions', {
			statusCode: 401,
			body: { error: 'Invalid API key' }
		}).as('apiError')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@apiError')

		// Should show error message or handle gracefully
		cy.get('.notice').should('contain', 'Error')
	})

	it('should respect token limits', () => {
		cy.setPluginSettings({
			maxInputTokens: 100,
			maxResponseTokens: 50
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Write a very long essay about the history of computers')

		cy.mockOpenAIResponse({
			choices: [
				{
					message: {
						content: 'Computers have evolved...'
					}
				}
			]
		})

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@openaiRequest').then((interception) => {
			const requestBody = interception.request.body

			// Verify token limits are respected in request
			expect(requestBody).to.have.property('max_tokens')
			if (requestBody.max_tokens) {
				expect(requestBody.max_tokens).to.be.at.most(50)
			}
		})
	})

	it('should use custom system prompt', () => {
		const customPrompt =
			'You are a helpful assistant that speaks like a pirate.'

		cy.setPluginSettings({
			systemPrompt: customPrompt
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Hello there!')

		cy.mockOpenAIResponse({
			choices: [
				{
					message: {
						content: 'Ahoy matey! How can I help ye today?'
					}
				}
			]
		})

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@openaiRequest').then((interception) => {
			const messages = interception.request.body.messages
			const systemMessage = messages.find((msg) => msg.role === 'system')

			expect(systemMessage).to.exist
			expect(systemMessage.content).to.equal(customPrompt)
		})
	})
})
