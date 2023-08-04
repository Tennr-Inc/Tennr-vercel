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

    const agentId = process.env.TENNR_AGENT_ID
    const agentUrl = 'https://agent.tennr.com'
    const streamIt = true

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
      responseStream = customLogicToStream(response)
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

function customLogicToStream(response: Response) {
  const reader = response?.body?.getReader()
  if (!reader) throw new Error('No reader created.')

  const decoder = new TextDecoder('utf-8')
  let messageAccumulator = ''
  let currResponseMessage = ''

  return new ReadableStream({
    start(controller) {
      const read = async () => {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        const decodedValue = decoder.decode(value)
        messageAccumulator += decodedValue

        const messages = messageAccumulator.split('\n\n')
        messageAccumulator = messages.pop() || ''

        for (let message of messages) {
          message = message
            .split('\n')
            .map(line => line.replace(/^data: /, ''))
            .join('\n')

          if (message === '[DONE]') continue

          if (message.indexOf(`"statusUpdate":`) !== -1) {
            try {
              const statusUpdateParsed = JSON.parse(message)
              const statusUpdate = statusUpdateParsed?.statusUpdate

              console.log('status update', statusUpdate)

              if (
                statusUpdate &&
                statusUpdate.output &&
                statusUpdate.stepType === 'GENERATE_ANSWER'
              ) {
                let outputText = statusUpdate.output.replace(/<br\/>/g, '\n') // replace <br/> with newline
                outputText = outputText.replace(/&amp;/g, '&') // replace &amp; with &
                // add similar replacements for other HTML entities if needed

                const newPart = outputText.slice(currResponseMessage.length)
                if (newPart.length > 0) {
                  controller.enqueue(new TextEncoder().encode(newPart))
                }
                currResponseMessage = outputText
              }
            } catch (e) {
              console.error('Failed to parse status update.', e)
            }
          }
        }
        read()
      }
      read()
    }
  })
}
