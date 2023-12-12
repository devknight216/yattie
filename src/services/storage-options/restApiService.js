import axios from "axios";
import StorageInterface from "../storageInterface";

export default class RestApiService extends StorageInterface {
  async getState() {
    const response = await axios.get(`http://localhost:3000/state`);
    return response.data;
  }

  async updateState(state) {
    console.log(state);
    // saving state endpoint here
  }

  async getConfig() {
    const response = await axios.get(`http://localhost:3000/config`);
    return response.data;
  }

  async getCredentials() {
    const response = await axios.get(`http://localhost:3000/credentials`);
    return response.data;
  }

  async updateCredentials(credentials) {
    console.log(credentials);
    // saving credentials endpoint here
  }

  async getItems() {
    const response = await axios.get(`http://localhost:3000/items`);
    return response.data;
  }

  async getItemById(id) {
    console.log(id);
    const response = await axios.get(`http://localhost:3000/item`);
    return response.data;
  }

  async updateItems(items) {
    console.log(items);
    // saving state endpoint here
  }

  async getNotes() {
    const response = await axios.get(`http://localhost:3000/notes`);
    return response.data;
  }

  async updateNotes(notes) {
    console.log(notes);
    // saving notes endpoint here
  }
}
