const baseUrl = process.env.API_GATEWAY_URL ?? "http://localhost:3000";

async function main(): Promise<void> {
  await expectOk(`${baseUrl}/health`, "api gateway health");

  const createResponse = await fetch(`${baseUrl}/transactions`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      userId: "baseline-smoke-user",
      amount: 12.5,
      currency: "USD",
      description: "Phase 3 smoke transaction"
    })
  });

  if (createResponse.status !== 201) {
    throw new Error(`transaction smoke create returned ${createResponse.status}`);
  }

  const created = (await createResponse.json()) as {
    transaction?: { id?: string };
  };

  if (!created.transaction?.id) {
    throw new Error("transaction smoke create did not return an id");
  }

  await expectOk(`${baseUrl}/transactions/${created.transaction.id}`, "transaction read");
  await expectOk(`${baseUrl}/users/baseline-smoke-user/transactions`, "user history");

  console.log("baseline smoke check passed");
}

async function expectOk(url: string, label: string): Promise<void> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}`);
  }
}

void main();
