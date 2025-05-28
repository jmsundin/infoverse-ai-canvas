describe('Chat Stream Plugin Loading', () => {
	beforeEach(() => {
		// Mock Obsidian environment
		cy.visit('/')
		cy.waitForObsidianLoad()
	})

	it('should load the plugin successfully', () => {
		cy.checkPluginLoaded('chat-stream')
	})

	it('should register all plugin commands', () => {
		cy.window().then((win) => {
			const commands = win.app.commands.commands

			// Check if the plugin commands are registered
			expect(commands).to.have.property('chat-stream:next-note')
			expect(commands).to.have.property('chat-stream:generate-note')
			expect(commands).to.have.property('chat-stream:generate-mindmap')
		})
	})

	it('should have default settings loaded', () => {
		cy.window().then((win) => {
			const plugin = win.app.plugins.plugins['chat-stream']

			expect(plugin.settings).to.exist
			expect(plugin.settings.provider).to.equal('OpenAI')
			expect(plugin.settings.temperature).to.be.a('number')
			expect(plugin.settings.systemPrompt).to.be.a('string')
		})
	})

	it('should have hotkeys registered', () => {
		cy.window().then((win) => {
			const hotkeys = win.app.hotkeyManager.customKeys

			// Check for registered hotkeys
			const chatStreamHotkeys = Object.values(hotkeys).filter((hotkey) =>
				hotkey.command?.startsWith('chat-stream:')
			)

			expect(chatStreamHotkeys.length).to.be.greaterThan(0)
		})
	})

	it('should not have console errors on load', () => {
		cy.shouldNotHaveConsoleErrors()
	})
})
