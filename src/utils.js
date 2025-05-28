function getEnv(envName, defaultValue) {
    const envValue = process.env[envName] || defaultValue;

    if (envValue === undefined) {
        throw new Error(`Env variable ${envName} is not defined`);
    }

    return envValue;
}

module.exports = {getEnv};
