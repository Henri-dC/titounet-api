const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;

// Instancier l’API
const api = new WooCommerceRestApi({
  url: "https://www.tontonriton.com",
  consumerKey: "ok",
  consumerSecret: "ok",
  version: "wc/v3",
});

// ID du produit à modifier
const productId = 2861;

// Données à modifier
const updatedData = {
  name: "Suzanne 2 (via SDK)",
  regular_price: "42.99",
};

// Requête PUT
api
  .put(`products/${productId}`, updatedData)
  .then((response) => {
    console.log("✅ Produit mis à jour :", response.data);
  })
  .catch((error) => {
    console.error(
      "❌ Erreur lors de la mise à jour :",
      error.response?.data || error.message
    );
  });
