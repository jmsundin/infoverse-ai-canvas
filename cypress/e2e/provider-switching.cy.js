describe('Chat Stream Provider Switching', () => {
	beforeEach(() => {
		cy.visit('/')
		cy.waitForObsidianLoad()
		cy.checkPluginLoaded('chat-stream')
	})

	it('should switch from OpenAI to Gemini provider', () => {
		// Start with OpenAI
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.default)
		})

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.provider).to.equal('OpenAI')
		})

		// Switch to Gemini
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.gemini_provider)
		})

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.provider).to.equal('Gemini')
			expect(plugin.settings.geminiApiKey).to.equal('test-gemini-key-456')
		})
	})

	it('should make requests to OpenAI endpoint', () => {
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
		cy.addNoteToCanvas('Test OpenAI request')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@openaiRequest').then((interception) => {
			expect(interception.request.url).to.include('openai')
			expect(interception.request.body).to.have.property('model')
			expect(interception.request.headers).to.have.property('authorization')
		})

		cy.get('.canvas-node').should('have.length', 2)
	})

	it('should make requests to Gemini endpoint', () => {
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.gemini_provider)
		})

		cy.fixture('api-responses').then((responses) => {
			cy.intercept('POST', '**/generateContent*', {
				statusCode: 200,
				body: responses.gemini.simple_response
			}).as('geminiRequest')
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Test Gemini request')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@geminiRequest').then((interception) => {
			expect(interception.request.url).to.include(
				'generativelanguage.googleapis.com'
			)
			expect(interception.request.body).to.have.property('contents')
			expect(interception.request.url).to.include('key=')
		})

		cy.get('.canvas-node').should('have.length', 2)
	})

	it('should preserve model selection when switching providers', () => {
		// Set OpenAI with specific model
		cy.setPluginSettings({
			provider: 'OpenAI',
			apiModel: 'gpt-4',
			lastOpenAIModel: 'gpt-4'
		})

		// Switch to Gemini
		cy.setPluginSettings({
			provider: 'Gemini',
			apiModel: 'gemini-1.5-pro',
			lastGeminiModel: 'gemini-1.5-pro'
		})

		// Switch back to OpenAI
		cy.setPluginSettings({
			provider: 'OpenAI'
		})

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			// Should restore previous OpenAI model
			expect(plugin.settings.lastOpenAIModel).to.equal('gpt-4')
		})
	})

	it('should handle different response formats', () => {
		// Test OpenAI response format
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
		cy.addNoteToCanvas('Test response format OpenAI')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@openaiRequest')
		cy.get('.canvas-node').should('have.length', 2)
		cy.get('.canvas-node')
			.last()
			.should('contain', 'simple test response from OpenAI')

		// Clear canvas and test Gemini response format
		cy.get('.canvas-node').each(($node) => {
			cy.wrap($node).trigger('keydown', { key: 'Delete' })
		})

		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.gemini_provider)
		})

		cy.fixture('api-responses').then((responses) => {
			cy.intercept('POST', '**/generateContent*', {
				statusCode: 200,
				body: responses.gemini.simple_response
			}).as('geminiRequest')
		})

		cy.addNoteToCanvas('Test response format Gemini')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@geminiRequest')
		cy.get('.canvas-node').should('have.length', 2)
		cy.get('.canvas-node')
			.last()
			.should('contain', 'simple test response from Gemini')
	})

	it('should handle provider-specific errors', () => {
		// Test OpenAI error
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.default)
		})

		cy.fixture('api-responses').then((responses) => {
			cy.intercept('POST', '**/chat/completions', {
				statusCode: 401,
				body: responses.openai.error_response
			}).as('openaiError')
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Test OpenAI error')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@openaiError')

		// Should handle OpenAI error format
		cy.get('.notice').should('contain', 'Invalid API key')

		// Test Gemini error
		cy.fixture('test-settings').then((settings) => {
			cy.setPluginSettings(settings.gemini_provider)
		})

		cy.intercept('POST', '**/generateContent*', {
			statusCode: 400,
			body: {
				error: {
					code: 400,
					message: 'API key not valid',
					status: 'INVALID_ARGUMENT'
				}
			}
		}).as('geminiError')

		cy.get('.canvas-node').each(($node) => {
			cy.wrap($node).trigger('keydown', { key: 'Delete' })
		})

		cy.addNoteToCanvas('Test Gemini error')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		cy.wait('@geminiError')

		// Should handle Gemini error format
		cy.get('.notice').should('contain', 'API key not valid')
	})

	it('should validate API keys for each provider', () => {
		// Test missing OpenAI key
		cy.setPluginSettings({
			provider: 'OpenAI',
			openaiApiKey: ''
		})

		cy.openCanvas()
		cy.addNoteToCanvas('Test missing OpenAI key')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		// Should show error about missing API key
		cy.get('.notice').should('contain', 'API key')

		// Test missing Gemini key
		cy.setPluginSettings({
			provider: 'Gemini',
			geminiApiKey: ''
		})

		cy.get('.canvas-node').each(($node) => {
			cy.wrap($node).trigger('keydown', { key: 'Delete' })
		})

		cy.addNoteToCanvas('Test missing Gemini key')

		cy.get('.canvas-node').first().click()
		cy.triggerCommand('Generate AI note')

		// Should show error about missing API key
		cy.get('.notice').should('contain', 'API key')
	})
})
