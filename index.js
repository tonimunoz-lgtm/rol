rules_version = '2';

service firebase.storage {
  match /b/{bucket}/o {

    function esMaster() {
      return request.auth != null &&
        firestore.exists(/databases/(default)/documents/masters/$(request.auth.uid));
    }

    match /partidas/{partidaId}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if esMaster();
    }
  }
}
