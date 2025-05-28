import { defineConfig } from 'cypress'

export default defineConfig({
	e2e: {
		baseUrl: 'http://localhost:3000',
		specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',
		supportFile: 'cypress/support/e2e.js',
		videosFolder: 'cypress/videos',
		screenshotsFolder: 'cypress/screenshots',
		fixturesFolder: 'cypress/fixtures',
		viewportWidth: 1280,
		viewportHeight: 720,
		setupNodeEvents(on, config) {
			// implement node event listeners here
		}
	},
	component: {
		devServer: {
			framework: 'create-react-app',
			bundler: 'webpack'
		},
		specPattern: 'cypress/component/**/*.cy.{js,jsx,ts,tsx}',
		supportFile: 'cypress/support/component.js'
	}
})
