import asyncio
import websockets
import json

async def probe_gateway():
    uri = "ws://localhost:18789"
    async with websockets.connect(uri) as websocket:
        print(f"Connected to {uri}")
        
        # Try sending a simple config request
        request = {
            "id": "1",
            "method": "config.get",
            "params": {}
        }
        await websocket.send(json.dumps(request))
        print(f"Sent: {request}")
        
        response = await websocket.recv()
        print(f"Received: {response}")

if __name__ == "__main__":
    asyncio.get_event_loop().run_until_complete(probe_gateway())
