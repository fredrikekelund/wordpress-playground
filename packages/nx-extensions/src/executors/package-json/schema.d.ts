export interface PackageJsonExecutorSchema {
	tsConfig: string;
	outputPath: string;
	buildTarget: string;
	excludedDependencies?: string[];
} // eslint-disable-line
