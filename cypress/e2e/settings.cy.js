describe('Chat Stream Settings', () => {
	beforeEach(() => {
		cy.visit('/')
		cy.waitForObsidianLoad()
		cy.checkPluginLoaded('chat-stream')
	})

	it('should open settings tab', () => {
		cy.openSettingsTab()

		// Verify settings elements are visible
		cy.contains('API Settings').should('be.visible')
		cy.contains('Provider').should('be.visible')
		cy.contains('Temperature').should('be.visible')
	})

	it('should update API key settings', () => {
		cy.setPluginSettings({
			openaiApiKey: 'test-api-key-123'
		})

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.openaiApiKey).to.equal('test-api-key-123')
		})
	})

	it('should switch between providers', () => {
		cy.setPluginSettings({
			provider: 'Gemini',
			geminiApiKey: 'test-gemini-key'
		})

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.provider).to.equal('Gemini')
			expect(plugin.settings.geminiApiKey).to.equal('test-gemini-key')
		})
	})

	it('should validate temperature range', () => {
		cy.setPluginSettings({
			temperature: 1.5
		})

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.temperature).to.be.within(0, 2)
		})
	})

	it('should save and load settings', () => {
		const testSettings = {
			provider: 'OpenAI',
			temperature: 0.7,
			maxInputTokens: 1000,
			enableAutoSplit: true,
			systemPrompt: 'Custom test prompt'
		}

		cy.setPluginSettings(testSettings)

		// Reload plugin to test persistence
		cy.window()
			.then((win) => {
				const plugin = win.app.plugins.plugins['chat-stream']
				return plugin.loadSettings()
			})
			.then(() => {
				cy.window().then((win) => {
					const plugin = win.app.plugins.plugins['chat-stream']
					expect(plugin.settings.provider).to.equal(testSettings.provider)
					expect(plugin.settings.temperature).to.equal(testSettings.temperature)
					expect(plugin.settings.maxInputTokens).to.equal(
						testSettings.maxInputTokens
					)
					expect(plugin.settings.enableAutoSplit).to.equal(
						testSettings.enableAutoSplit
					)
					expect(plugin.settings.systemPrompt).to.equal(
						testSettings.systemPrompt
					)
				})
			})
	})

	it('should handle streaming settings', () => {
		cy.setPluginSettings({
			enableStreaming: true,
			streamingUpdateInterval: 300,
			streamingChunkSize: 150,
			showStreamingProgress: true
		})

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.enableStreaming).to.be.true
			expect(plugin.settings.streamingUpdateInterval).to.equal(300)
			expect(plugin.settings.streamingChunkSize).to.equal(150)
			expect(plugin.settings.showStreamingProgress).to.be.true
		})
	})

	it('should handle mindmap settings', () => {
		cy.setPluginSettings({
			mindmapColorTheme: '3',
			enableMindmapColorCoding: true,
			mindmapSpacing: 'spacious',
			mindmapLayoutAlgorithm: 'hierarchical'
		})

		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']
			expect(plugin.settings.mindmapColorTheme).to.equal('3')
			expect(plugin.settings.enableMindmapColorCoding).to.be.true
			expect(plugin.settings.mindmapSpacing).to.equal('spacious')
			expect(plugin.settings.mindmapLayoutAlgorithm).to.equal('hierarchical')
		})
	})
})
