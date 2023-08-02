import { StreamingTextResponse } from 'ai'

import { auth } from '@/auth'

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const { messages } = json
    const userId = (await auth())?.user.id

    if (!userId) {
      return new Response('Unauthorized', {
        status: 401
      })
    }

    const agentId = process.env.TENNR_AGENT_ID;
    const agentUrl = 'https://agent.tennr.com'
    var streamIt = false

    const response = await fetch(agentUrl + '/api/v1/workflow/run', {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `api-key ${process.env.TENNR_API_KEY}`
      },
      body: JSON.stringify({
        agentId: agentId,
        input: messages[messages.length - 1].content,
        stream: streamIt,
        messages: messages
      })
    })

    let responseStream
    if (streamIt) {
      const responseText = await response.text()

      const messageArr = responseText
        .split('\n\n')
        .filter(message => message.startsWith('data:'))
        .map(message => message.slice('data: '.length))

      const combinedMessages = messageArr.join('')

      // Removing the unwanted part
      const cleanedMessages = combinedMessages
        .replace(/{"sources":\[.*\]}/, '')
        .trim()

      responseStream = arrayToStream([cleanedMessages])
    } else {
      const responseJson = JSON.parse(await response.text())
      const outputText = responseJson.output // Extract the output text.
      responseStream = stringToStream(outputText)
    }

    return new StreamingTextResponse(responseStream)
  } catch (e) {
    console.error(e)
  }
}

function stringToStream(response: string) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(response))
      controller.close()
    }
  })
}

function arrayToStream(array: string[]) {
  let currentIndex = 0

  return new ReadableStream({
    pull(controller) {
      if (currentIndex >= array.length) {
        controller.close()
      } else {
        // Append a newline and enqueue the message as is, without JSON.stringify
        const text = array[currentIndex] + '\n'
        controller.enqueue(new TextEncoder().encode(text))
        currentIndex++
      }
    }
  })
}
