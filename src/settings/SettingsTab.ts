import { App, PluginSettingTab, Setting } from 'obsidian'
import { InfoverseAICanvasPlugin } from 'src/InfoverseAICanvasPlugin'
import { getModelsByProvider } from './InfoverseAICanvasSettings'
import { PROVIDERS } from 'src/models/providers'

export class SettingsTab extends PluginSettingTab {
	plugin: InfoverseAICanvasPlugin

	constructor(app: App, plugin: InfoverseAICanvasPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display(): void {
		const { containerEl } = this

		containerEl.empty()

		// Provider selection
		new Setting(containerEl)
			.setName('Provider')
			.setDesc('Select the AI provider to use.')
			.addDropdown((cb) => {
				Object.values(PROVIDERS).forEach((provider) => {
					cb.addOption(provider, provider)
				})
				cb.setValue(this.plugin.settings.provider)
				cb.onChange(async (value) => {
					// Save current model selection for the current provider
					if (this.plugin.settings.provider === 'OpenAI') {
						this.plugin.settings.lastOpenAIModel = this.plugin.settings.apiModel
					} else if (this.plugin.settings.provider === 'Gemini') {
						this.plugin.settings.lastGeminiModel = this.plugin.settings.apiModel
					}

					// Update provider
					this.plugin.settings.provider = value

					// Restore last selected model for new provider, or use first available
					const availableModels = getModelsByProvider(value)
					if (availableModels.length > 0) {
						let targetModel = availableModels[0] // fallback

						if (value === 'OpenAI' && this.plugin.settings.lastOpenAIModel) {
							// Check if the last OpenAI model is still available
							if (availableModels.includes(this.plugin.settings.lastOpenAIModel)) {
								targetModel = this.plugin.settings.lastOpenAIModel
							}
						} else if (value === 'Gemini' && this.plugin.settings.lastGeminiModel) {
							// Check if the last Gemini model is still available
							if (availableModels.includes(this.plugin.settings.lastGeminiModel)) {
								targetModel = this.plugin.settings.lastGeminiModel
							}
						}

						this.plugin.settings.apiModel = targetModel
					}

					await this.plugin.saveSettings()
					this.display() // Refresh the settings to update model dropdown
				})
			})

		// Model selection (filtered by provider)
		new Setting(containerEl)
			.setName('Model')
			.setDesc('Select the AI model to use.')
			.addDropdown((cb) => {
				const availableModels = getModelsByProvider(this.plugin.settings.provider)
				availableModels.forEach((model) => {
					cb.addOption(model, model)
				})
				cb.setValue(this.plugin.settings.apiModel)
				cb.onChange(async (value) => {
					this.plugin.settings.apiModel = value

					// Also update the last selected model for this provider
					if (this.plugin.settings.provider === 'OpenAI') {
						this.plugin.settings.lastOpenAIModel = value
					} else if (this.plugin.settings.provider === 'Gemini') {
						this.plugin.settings.lastGeminiModel = value
					}

					await this.plugin.saveSettings()
				})
			})

		// API Keys section
		containerEl.createEl('h3', { text: 'API Keys' })

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key - Get from https://platform.openai.com/account/api-keys')
			.addText((text) => {
				text.inputEl.type = 'password'
				text
					.setPlaceholder('OpenAI API Key')
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.openaiApiKey = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Gemini API Key')
			.setDesc('Your Google Gemini API key - Get from https://makersuite.google.com/app/apikey')
			.addText((text) => {
				text.inputEl.type = 'password'
				text
					.setPlaceholder('Gemini API Key')
					.setValue(this.plugin.settings.geminiApiKey)
					.onChange(async (value) => {
						this.plugin.settings.geminiApiKey = value
						await this.plugin.saveSettings()
					})
			})

		// System prompt (used for mindmap / default generation)
		new Setting(containerEl)
			.setName('System prompt (mind-map / default)')
			.setDesc(
				`The system prompt sent with each request for mind-map or default responses.\n(Note: you can override this in-canvas by starting a note with 'SYSTEM PROMPT'.)`
			)
			.addTextArea((component) => {
				component.inputEl.rows = 6
				component.inputEl.style.width = '300px'
				component.inputEl.style.fontSize = '10px'
				component.setValue(this.plugin.settings.systemPrompt)
				component.onChange(async (value) => {
					this.plugin.settings.systemPrompt = value
					await this.plugin.saveSettings()
				})
			})

		new Setting(containerEl)
			.setName('Max input tokens')
			.setDesc(
				'The maximum number of tokens to send (within model limit). 0 means as many as possible'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.maxInputTokens.toString())
					.onChange(async (value) => {
						const parsed = parseInt(value)
						if (!isNaN(parsed)) {
							this.plugin.settings.maxInputTokens = parsed
							await this.plugin.saveSettings()
						}
					})
			)

		new Setting(containerEl)
			.setName('Max response tokens')
			.setDesc(
				'The maximum number of tokens to return from the API. 0 means no limit. (A token is about 4 characters).'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.maxResponseTokens.toString())
					.onChange(async (value) => {
						const parsed = parseInt(value)
						if (!isNaN(parsed)) {
							this.plugin.settings.maxResponseTokens = parsed
							await this.plugin.saveSettings()
						}
					})
			)

		new Setting(containerEl)
			.setName('Max depth')
			.setDesc(
				'The maximum depth of ancestor notes to include. 0 means no limit.'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.maxDepth.toString())
					.onChange(async (value) => {
						const parsed = parseInt(value)
						if (!isNaN(parsed)) {
							this.plugin.settings.maxDepth = parsed
							await this.plugin.saveSettings()
						}
					})
			)

		new Setting(containerEl)
			.setName('Temperature')
			.setDesc('Sampling temperature (0-2). 0 means no randomness.')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.temperature.toString())
					.onChange(async (value) => {
						const parsed = parseFloat(value)
						if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) {
							this.plugin.settings.temperature = parsed
							await this.plugin.saveSettings()
						}
					})
			)

		new Setting(containerEl)
			.setName('API URL')
			.setDesc(
				"The chat completions URL to use. You probably won't need to change this."
			)
			.addText((text) => {
				text.inputEl.style.width = '300px'
				text
					.setPlaceholder('API URL')
					.setValue(this.plugin.settings.apiUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiUrl = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Debug output')
			.setDesc('Enable debug output in the console')
			.addToggle((component) => {
				component
					.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Auto-split responses')
			.setDesc('Automatically split AI responses into multiple logical notes arranged as a mindmap')
			.addToggle((component) => {
				component
					.setValue(this.plugin.settings.enableAutoSplit)
					.onChange(async (value) => {
						this.plugin.settings.enableAutoSplit = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Max split notes')
			.setDesc('Maximum number of notes to create when auto-splitting. 0 means no limit.')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.maxSplitNotes.toString())
					.onChange(async (value) => {
						const parsed = parseInt(value)
						if (!isNaN(parsed) && parsed >= 0) {
							this.plugin.settings.maxSplitNotes = parsed
							await this.plugin.saveSettings()
						}
					})
			)

		containerEl.createEl('h3', { text: 'Mindmap Visualization' })

		new Setting(containerEl)
			.setName('Mindmap color theme')
			.setDesc('Base color for mindmap nodes (1=red, 2=orange, 3=yellow, 4=green, 5=cyan, 6=purple)')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('1', 'Red')
					.addOption('2', 'Orange')
					.addOption('3', 'Yellow')
					.addOption('4', 'Green')
					.addOption('5', 'Cyan')
					.addOption('6', 'Purple')
					.setValue(this.plugin.settings.mindmapColorTheme)
					.onChange(async (value) => {
						this.plugin.settings.mindmapColorTheme = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Enable color coding')
			.setDesc('Use different colors for different types of content in mindmap (code, lists, text)')
			.addToggle((component) => {
				component
					.setValue(this.plugin.settings.enableMindmapColorCoding)
					.onChange(async (value) => {
						this.plugin.settings.enableMindmapColorCoding = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Mindmap spacing')
			.setDesc('Control the density and spacing of mindmap nodes')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('compact', 'Compact')
					.addOption('normal', 'Normal')
					.addOption('spacious', 'Spacious')
					.setValue(this.plugin.settings.mindmapSpacing)
					.onChange(async (value) => {
						this.plugin.settings.mindmapSpacing = value as 'compact' | 'normal' | 'spacious'
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Mindmap layout algorithm')
			.setDesc('Choose how nodes are arranged in mindmaps (organic=natural branching, hierarchical=layered, force=balanced, radial=simple)')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('organic', 'Organic (Natural)')
					.addOption('hierarchical', 'Hierarchical (Layered)')
					.addOption('force', 'Force-directed (Balanced)')
					.addOption('radial', 'Radial (Simple)')
					.setValue(this.plugin.settings.mindmapLayoutAlgorithm)
					.onChange(async (value) => {
						this.plugin.settings.mindmapLayoutAlgorithm = value as 'radial' | 'hierarchical' | 'organic' | 'force'
						await this.plugin.saveSettings()
					})
			})
	}
}

export default SettingsTab
