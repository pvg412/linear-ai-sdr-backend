#!/bin/bash

curl -X POST "http://localhost:3001/telegram/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 1,
    "message": {
      "message_id": 1,
      "from": {
        "id": 486444777,
        "is_bot": false,
        "first_name": "Alex",
        "username": "test_user"
      },
      "chat": {
        "id": 486444777,
        "type": "private",
        "first_name": "Alex",
        "username": "test_user"
      },
      "date": 1765063700,
      "text": "yes"
    }
  }'
